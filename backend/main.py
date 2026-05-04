"""
ChaosComm — FastAPI backend entry point.

Foundational app + the chaotic-map API routes.  Future modules
(bifurcation, quantization, CSK, BER, radar) add their own routes by
appending to this file or by mounting routers per module.
"""

import time
import asyncio
import json
import os
from contextlib import asynccontextmanager

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from matlab_backend.engine_wrapper import MatlabEngineWrapper, MatlabUnavailable

from core import maps as maps_core
from core import bifurcation as bif_core
from core import quantization as quant_core
from core import pdf_estimator as pdf_core
from core import signal_processing as sig_core
from core import waveform as wav_core
from core import matched_filter as mf_core
from core import channel as channel_core
from core import correlation as corr_core
from core import spectrum as spec_core
from core import ber as ber_core
from core import radar as radar_core




# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
load_dotenv()

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))

_default_origins = "http://localhost:5173,http://127.0.0.1:5173"
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",")]


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.matlab = MatlabEngineWrapper()
    app.state.matlab.probe()
    yield
    app.state.matlab.shutdown()


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="ChaosComm Backend",
    description="Chaotic signal processing, CSK/DCSK communications, and chaotic radar API.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Foundational routes
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    """Liveness probe."""
    return {"status": "ok"}


@app.get("/backend-info")
async def backend_info():
    """Reports MATLAB availability for the frontend MATLAB toggle."""
    matlab = app.state.matlab
    return {
        "matlab_available": matlab.available,
        "matlab_version": matlab.version,
        "matlab_error": matlab.error_message,
        "numpy_available": True,
        "active_backend": "matlab" if matlab.available else "numpy",
    }


# ===========================================================================
# CHAOTIC MAPS API
# ===========================================================================

class RadarRequest(BaseModel):
    length: int = Field(256, ge=64, le=2048)
    delay: int = Field(20, ge=0, le=512)
    doppler: float = Field(0.05, ge=-1.0, le=1.0)
    snr_db: float = Field(20.0, ge=-20.0, le=60.0)

class OrbitRequest(BaseModel):
    """Body of POST /api/maps/orbit."""
    map: str = Field(..., description="Map ID (logistic, tent, ..., custom).")
    parameters: dict[str, float] = Field(default_factory=dict)
    initial_state: list[float] = Field(default_factory=lambda: [0.31415])
    n_samples: int = Field(2000, ge=100, le=maps_core.MAX_N_SAMPLES)
    custom_expression: str | None = None


class CobwebRequest(BaseModel):
    """Body of POST /api/maps/cobweb."""
    map: str
    parameters: dict[str, float] = Field(default_factory=dict)
    x0: float = 0.31415
    n_steps: int = Field(60, ge=1, le=500)
    custom_expression: str | None = None


@app.get("/api/maps/registry")
async def maps_registry():
    """
    Return all built-in maps + concept explainers + custom-map metadata.

    The frontend uses this to populate selectors and parameter sliders
    without hardcoding the registry — single source of truth lives here.
    """
    return maps_core.get_registry_payload()


@app.post("/api/maps/orbit")
async def maps_orbit(req: OrbitRequest):
    """Iterate the chosen map; return orbit + symbolic Lyapunov + fixed points."""
    try:
        return maps_core.compute_orbit(
            map_name=req.map,
            parameters=req.parameters,
            initial_state=req.initial_state,
            n_samples=req.n_samples,
            custom_expression=req.custom_expression,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}: {e}")


@app.post("/api/maps/cobweb")
async def maps_cobweb(req: CobwebRequest):
    """Return the f(x) curve and the cobweb polyline for a given map + x0."""
    try:
        return maps_core.compute_cobweb(
            map_name=req.map,
            parameters=req.parameters,
            x0=req.x0,
            n_steps=req.n_steps,
            custom_expression=req.custom_expression,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}: {e}")


# ===========================================================================
# BIFURCATION API
# ===========================================================================

class BifurcationSnapshotRequest(BaseModel):
    """Synchronous low-resolution snapshot for previews and thumbnails."""
    map: str
    p_min: float | None = None       # if omitted, uses default range for the map
    p_max: float | None = None
    n_params: int = Field(400, ge=5, le=4000)
    n_transient: int = Field(400, ge=50, le=5000)
    n_plot: int = Field(120, ge=10, le=1000)
    x0: float = 0.31415
    backend: str = "auto"             # "auto" | "numpy" | "matlab"
    custom_expression: str | None = None


class FeigenbaumRequest(BaseModel):
    map: str = "logistic"
    p_min: float | None = None
    p_max: float | None = None
    n_params: int = Field(800, ge=200, le=5000)


class LyapunovSweepRequest(BaseModel):
    """Fast vectorized λ(r) sweep — no period-doubling detection."""
    map: str
    p_min: float | None = None
    p_max: float | None = None
    n_params: int = Field(800, ge=50, le=5000)


class BifurcationStreamRequest(BaseModel):
    """WebSocket initial-message schema (validated server-side, not by FastAPI)."""
    map: str
    p_min: float | None = None
    p_max: float | None = None
    n_params: int = 1500
    n_transient: int = 600
    n_plot: int = 250
    x0: float = 0.31415
    chunk_size: int = 50
    custom_expression: str | None = None


def _resolve_range(req_map: str, req_min: float | None, req_max: float | None) -> tuple[float, float]:
    """If the request omits the range, fall back to the map's default."""
    if req_min is not None and req_max is not None:
        if req_max <= req_min:
            raise ValueError("p_max must exceed p_min")
        return float(req_min), float(req_max)
    return bif_core.default_range_for(req_map)


@app.get("/api/bifurcation/explainers")
async def bifurcation_explainers():
    """Concept explainer text for the bifurcation page."""
    return bif_core.get_bifurcation_explainers()


@app.post("/api/bifurcation/snapshot")
async def bifurcation_snapshot(req: BifurcationSnapshotRequest):
    """
    Synchronous, low-resolution preview.  Used for thumbnails on the maps
    page and for the very first paint when the user opens the bifurcation
    page (replaced by the streaming high-res result a few seconds later).
    """
    try:
        p_min, p_max = _resolve_range(req.map, req.p_min, req.p_max)

        # Backend selection
        use_matlab = False
        if req.backend == "matlab":
            use_matlab = app.state.matlab.available and req.map != "custom"
        elif req.backend == "auto":
            use_matlab = app.state.matlab.available and req.map != "custom"

        if use_matlab:
            try:
                # Run MATLAB in a thread — engine calls are blocking C calls.
                result = await asyncio.to_thread(
                    bif_core.bifurcation_sweep_matlab,
                    req.map, p_min, p_max,
                    req.n_params, req.n_transient, req.n_plot,
                    req.x0,
                    app.state.matlab,
                )
                return result
            except (MatlabUnavailable, RuntimeError):
                # Transparent fallback
                pass

        return await asyncio.to_thread(
            bif_core.bifurcation_sweep_numpy,
            req.map, p_min, p_max,
            req.n_params, req.n_transient, req.n_plot,
            req.x0,
            req.custom_expression,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}: {e}")


@app.post("/api/bifurcation/feigenbaum")
async def bifurcation_feigenbaum(req: FeigenbaumRequest):
    """
    Detect period-doublings and compute Feigenbaum δ + a∞ for the chosen map.
    Returns the rₙ sequence, successive δ ratios, the final δ estimate, and
    the extrapolated chaos onset a∞.

    NOTE: This endpoint is slow (~30-90s) because period-doubling detection
    probes individual orbits sequentially.  For the λ(r) curve alone, use
    the much faster POST /api/bifurcation/lyapunov instead.
    """
    try:
        p_min, p_max = _resolve_range(req.map, req.p_min, req.p_max)
        return await asyncio.to_thread(
            bif_core.feigenbaum_for_map,
            req.map, p_min, p_max, req.n_params,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}: {e}")


@app.post("/api/bifurcation/lyapunov")
async def bifurcation_lyapunov(req: LyapunovSweepRequest):
    """
    Fast vectorized λ(r) sweep — returns in <1 second.
    No period-doubling detection or Feigenbaum analysis — just the curve.
    """
    try:
        p_min, p_max = _resolve_range(req.map, req.p_min, req.p_max)
        return await asyncio.to_thread(
            bif_core.lyapunov_sweep,
            req.map, p_min, p_max, req.n_params,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}: {e}")


@app.websocket("/ws/bifurcation")
async def ws_bifurcation(websocket: WebSocket):
    """
    Stream a high-resolution bifurcation diagram in chunks of `chunk_size`
    parameter values.  Protocol:
        client → server  : {"map":"logistic","p_min":2.5,"p_max":4.0, ...}  (one message)
        server → client  : {"type":"meta","total_chunks":N,...}
                           {"type":"chunk","chunk_idx":i,"param":[...],"x":[...]}
                           {"type":"complete"}
                           or {"type":"error","message":"..."}
    """
    await websocket.accept()
    try:
        # Read first message — the job specification
        raw = await websocket.receive_text()
        try:
            payload = json.loads(raw)
            spec = BifurcationStreamRequest(**payload)
        except Exception as e:
            await websocket.send_json({"type": "error", "message": f"Bad spec: {e}"})
            await websocket.close()
            return

        try:
            p_min, p_max = _resolve_range(spec.map, spec.p_min, spec.p_max)
        except ValueError as e:
            await websocket.send_json({"type": "error", "message": str(e)})
            await websocket.close()
            return

        total_chunks = (spec.n_params + spec.chunk_size - 1) // spec.chunk_size
        await websocket.send_json({
            "type": "meta",
            "map_id": spec.map,
            "p_min": p_min, "p_max": p_max,
            "n_params": spec.n_params,
            "n_transient": spec.n_transient,
            "n_plot": spec.n_plot,
            "chunk_size": spec.chunk_size,
            "total_chunks": total_chunks,
        })

        # Run the chunked generator inside a thread executor and forward
        # each chunk as it arrives.
        def producer():
            return list(
                bif_core.bifurcation_sweep_chunked(
                    map_name=spec.map,
                    p_min=p_min, p_max=p_max,
                    n_params=spec.n_params,
                    n_transient=spec.n_transient,
                    n_plot=spec.n_plot,
                    x0=spec.x0,
                    custom_expression=spec.custom_expression,
                    chunk_size=spec.chunk_size,
                )
            )

        # Stream chunks one at a time so the UI can paint left-to-right.
        # We compute one chunk per to_thread() call to keep the event loop
        # responsive (a single big to_thread would block until all chunks
        # are computed).
        gen = bif_core.bifurcation_sweep_chunked(
            map_name=spec.map,
            p_min=p_min, p_max=p_max,
            n_params=spec.n_params,
            n_transient=spec.n_transient,
            n_plot=spec.n_plot,
            x0=spec.x0,
            custom_expression=spec.custom_expression,
            chunk_size=spec.chunk_size,
        )
        for i, chunk in enumerate(gen):
            await websocket.send_json({
                "type": "chunk",
                "chunk_idx": i,
                "chunk_start_idx": chunk["chunk_start_idx"],
                "chunk_end_idx": chunk["chunk_end_idx"],
                "param": chunk["param"],
                "x": chunk["x"],
            })

        await websocket.send_json({"type": "complete"})
    except WebSocketDisconnect:
        return
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": f"{type(e).__name__}: {e}"})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ===========================================================================
# QUANTIZATION API
# ===========================================================================

class QuantizeRequest(BaseModel):
    """Body of POST /api/quantization/quantize."""
    orbit: list[float]
    method: str = "uniform_midrise"    # uniform_midrise | uniform_midtread | mu_law | a_law | lloyd_max
    n_levels: int = Field(8, ge=2, le=256)
    domain: list[float] = Field(default_factory=lambda: [0.0, 1.0])
    pdf_x: list[float] | None = None
    pdf_density: list[float] | None = None


class PDFEstimateRequest(BaseModel):
    """Body of POST /api/quantization/estimate-pdf."""
    orbit: list[float]
    map_name: str = ""
    parameters: dict[str, float] = Field(default_factory=dict)
    domain: list[float] = Field(default_factory=lambda: [0.0, 1.0])


class MSEComparisonRequest(BaseModel):
    """Body of POST /api/quantization/mse-comparison."""
    orbit: list[float]
    levels_list: list[int] = Field(default_factory=lambda: [2, 4, 8, 16, 32, 64])
    methods: list[str] | None = None
    domain: list[float] = Field(default_factory=lambda: [0.0, 1.0])
    pdf_x: list[float] | None = None
    pdf_density: list[float] | None = None


@app.get("/api/quantization/explainers")
async def quantization_explainers():
    """Concept explainer text for the quantization page."""
    return quant_core.get_quantization_explainers()


@app.post("/api/quantization/estimate-pdf")
async def quantization_estimate_pdf(req: PDFEstimateRequest):
    """
    Estimate the invariant measure (PDF) of a chaotic orbit.
    Returns KDE, parametric fit, and (when available) the known
    analytical form.  This feeds the Lloyd-Max quantizer.
    """
    try:
        orbit = np.asarray(req.orbit, dtype=np.float64)
        domain = tuple(req.domain)
        return await asyncio.to_thread(
            pdf_core.estimate_pdf,
            orbit, req.map_name, req.parameters, domain,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}: {e}")


@app.post("/api/quantization/quantize")
async def quantization_quantize(req: QuantizeRequest):
    """
    Quantize a chaotic orbit using the specified method.

    For Lloyd-Max, optionally supply pdf_x + pdf_density from a
    previous /estimate-pdf call for optimal boundary placement.
    """
    try:
        orbit = np.asarray(req.orbit, dtype=np.float64)
        domain = tuple(req.domain)
        pdf_x = np.asarray(req.pdf_x) if req.pdf_x else None
        pdf_d = np.asarray(req.pdf_density) if req.pdf_density else None
        return await asyncio.to_thread(
            quant_core.quantize_orbit,
            orbit, req.method, req.n_levels, pdf_x, pdf_d, domain,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}: {e}")


@app.post("/api/quantization/mse-comparison")
async def quantization_mse_comparison(req: MSEComparisonRequest):
    """
    Compute MSE and SQNR for multiple methods at multiple level counts.
    Returns a table the frontend plots as MSE-vs-N curves.
    """
    try:
        orbit = np.asarray(req.orbit, dtype=np.float64)
        domain = tuple(req.domain)
        pdf_x = np.asarray(req.pdf_x) if req.pdf_x else None
        pdf_d = np.asarray(req.pdf_density) if req.pdf_density else None
        return await asyncio.to_thread(
            quant_core.mse_vs_levels,
            orbit, req.levels_list, req.methods, pdf_x, pdf_d, domain,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}: {e}")


# ===========================================================================
# CSK / DCSK / FM-DCSK API
# ===========================================================================

class CSKPipelineRequest(BaseModel):
    """Full encode → (noiseless) → decode pipeline."""
    message: str = Field(..., max_length=64)
    scheme: str = "dcsk"                    # csk | dcsk | fm_dcsk
    map_name: str = "logistic"
    parameter: float = 3.9
    x0: float = 0.31415
    chips_per_bit: int = Field(40, ge=4, le=256)
    r0: float = 3.6                         # CSK only
    r1: float = 3.9                         # CSK only


class CSKModulateRequest(BaseModel):
    """Modulation only — returns the waveform for visualization."""
    bits: list[int]
    scheme: str = "dcsk"
    map_name: str = "logistic"
    parameter: float = 3.9
    x0: float = 0.31415
    chips_per_bit: int = Field(40, ge=4, le=256)
    r0: float = 3.6
    r1: float = 3.9


class PSDRequest(BaseModel):
    waveform: list[float]
    fs: float = 1.0


@app.get("/api/csk/explainers")
async def csk_explainers():
    """Concept explainers for the CSK page."""
    return sig_core.get_csk_explainers()


@app.post("/api/csk/pipeline")
async def csk_pipeline(req: CSKPipelineRequest):
    """
    Full end-to-end: message → bits → modulate → detect → recovered message.
    Noiseless channel (channel noise added in a later module).
    """
    try:
        return await asyncio.to_thread(
            sig_core.full_pipeline,
            req.message, req.scheme, req.map_name, req.parameter,
            req.x0, req.chips_per_bit, req.r0, req.r1,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}: {e}")


@app.post("/api/csk/modulate")
async def csk_modulate_route(req: CSKModulateRequest):
    """Modulation only (no detection). Returns waveform + per-bit metadata."""
    try:
        half = req.chips_per_bit // 2
        if req.scheme == "csk":
            return sig_core.csk_modulate(
                req.bits, req.map_name, req.r0, req.r1, req.x0, req.chips_per_bit,
            )
        elif req.scheme == "dcsk":
            return sig_core.dcsk_modulate(
                req.bits, req.map_name, req.parameter, req.x0, half,
            )
        elif req.scheme == "fm_dcsk":
            return sig_core.fmdcsk_modulate(
                req.bits, req.map_name, req.parameter, req.x0, half,
            )
        else:
            raise ValueError(f"Unknown scheme: {req.scheme}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}: {e}")


@app.post("/api/csk/psd")
async def csk_psd(req: PSDRequest):
    """Compute PSD of a waveform — used for spectral analysis of the CSK signal."""
    try:
        wav = np.asarray(req.waveform, dtype=np.float64)
        return sig_core.compute_psd(wav, req.fs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}: {e}")


@app.post("/api/csk/text-to-bits")
async def csk_text_to_bits(req: dict):
    """Convert text to binary — used for the ASCII animation."""
    text = req.get("text", "")
    bits = sig_core.text_to_bits(text)
    return {
        "text": text,
        "bits": bits,
        "analysis": sig_core.analyze_bits(bits),
    }


# ===========================================================================
# WAVEFORM CONSTRUCTION API
# ===========================================================================

class WaveformConstructRequest(BaseModel):
    """Construct a waveform from a chip sequence."""
    chips: list[float]
    pulse_shape: str = "nrz"          # nrz | raised_cosine | rrc
    samples_per_chip: int = Field(8, ge=1, le=64)
    alpha: float = Field(0.5, ge=0.0, le=1.0)


class WaveformCompareRequest(BaseModel):
    """Compare all three pulse shapes on the same chips."""
    chips: list[float]
    samples_per_chip: int = Field(8, ge=1, le=64)
    alpha: float = Field(0.5, ge=0.0, le=1.0)


@app.get("/api/waveform/explainers")
async def waveform_explainers():
    return wav_core.get_waveform_explainers()


@app.post("/api/waveform/construct")
async def waveform_construct(req: WaveformConstructRequest):
    """Construct a waveform from chips + pulse shape."""
    try:
        return await asyncio.to_thread(
            wav_core.construct_waveform,
            req.chips, req.pulse_shape, req.samples_per_chip, req.alpha,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}: {e}")


@app.post("/api/waveform/compare")
async def waveform_compare(req: WaveformCompareRequest):
    """Compare NRZ / Raised Cosine / RRC on the same chip sequence."""
    try:
        return await asyncio.to_thread(
            wav_core.compare_pulse_shapes,
            req.chips, req.samples_per_chip, req.alpha,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {type(e).__name__}: {e}")


# ===========================================================================
# MATCHED FILTER API
# ===========================================================================

class MFCompareRequest(BaseModel):
    """Compare all 3 MF implementations on the same signal."""
    received: list[float]
    template: list[float]


class MFROCRequest(BaseModel):
    signal_energy: float
    noise_variance: float
    n_thresholds: int = Field(200, ge=50, le=1000)


class MFProcessingGainRequest(BaseModel):
    n_chips: int = Field(100, ge=1, le=10000)


@app.get("/api/matched-filter/explainers")
async def mf_explainers():
    return mf_core.get_mf_explainers()


@app.post("/api/matched-filter/compare")
async def mf_compare(req: MFCompareRequest):
    """Run all 3 implementations on the same received + template."""
    try:
        r = np.asarray(req.received, dtype=np.float64)
        s = np.asarray(req.template, dtype=np.float64)
        return await asyncio.to_thread(mf_core.compare_implementations, r, s)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/matched-filter/roc")
async def mf_roc(req: MFROCRequest):
    """Compute theoretical ROC curve for the MF in AWGN."""
    try:
        return mf_core.compute_roc(req.signal_energy, req.noise_variance, req.n_thresholds)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/matched-filter/processing-gain")
async def mf_processing_gain(req: MFProcessingGainRequest):
    return mf_core.processing_gain(req.n_chips)



# ===========================================================================
# CHANNEL MODELS API
# ===========================================================================

class ChannelApplyRequest(BaseModel):
    """Body of POST /api/channel/apply."""
    waveform: list[float]
    channel_type: str = "ideal"
    params: dict = Field(default_factory=dict)


class ChannelCompareRequest(BaseModel):
    """Body of POST /api/channel/compare."""
    waveform: list[float]
    channel_specs: list[dict] | None = None


@app.get("/api/channel/explainers")
async def channel_explainers():
    """Concept explainer text for the Channel Models page."""
    return channel_core.get_channel_explainers()


@app.post("/api/channel/apply")
async def channel_apply(req: ChannelApplyRequest):
    """
    Apply one channel model to a transmitted waveform.

    Example:
        channel_type = "awgn"
        params = {"snr_db": 10, "seed": 1}
    """
    try:
        return await asyncio.to_thread(
            channel_core.apply_channel,
            req.waveform,
            req.channel_type,
            req.params,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Internal error: {type(e).__name__}: {e}",
        )


@app.post("/api/channel/compare")
async def channel_compare(req: ChannelCompareRequest):
    """
    Apply multiple channel models to the same waveform.

    Used by the frontend to compare:
        ideal vs AWGN vs fading vs multipath vs jamming
    """
    try:
        return await asyncio.to_thread(
            channel_core.compare_channels,
            req.waveform,
            req.channel_specs,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Internal error: {type(e).__name__}: {e}",
        )
    





 
# ===========================================================================
# CORRELATION ANALYSIS API
# ===========================================================================
 
class AutocorrRequest(BaseModel):
    sequence: list[float]
    normalize: bool = True
    max_lag: int | None = None
 
 
class CrossCorrRequest(BaseModel):
    seq_a: list[float]
    seq_b: list[float]
    normalize: bool = True
    max_lag: int | None = None
 
 
class FullCorrRequest(BaseModel):
    seq_a: list[float]
    seq_b: list[float]
    max_lag: int | None = None
 
 
class MeritSweepRequest(BaseModel):
    map_name: str = "logistic"
    param_min: float = 3.5
    param_max: float = 4.0
    n_params: int = Field(50, ge=5, le=200)
    seq_length: int = Field(128, ge=32, le=512)
 
 
class AmbiguityRequest(BaseModel):
    sequence: list[float]
    max_delay: int = Field(32, ge=4, le=128)
    n_doppler: int = Field(32, ge=8, le=64)
 
 
@app.get("/api/correlation/explainers")
async def correlation_explainers():
    return corr_core.get_correlation_explainers()
 
 
@app.post("/api/correlation/autocorr")
async def correlation_autocorr(req: AutocorrRequest):
    try:
        seq = np.asarray(req.sequence, dtype=np.float64)
        return await asyncio.to_thread(
            corr_core.autocorrelation, seq, req.normalize, req.max_lag
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
 
 
@app.post("/api/correlation/crosscorr")
async def correlation_crosscorr(req: CrossCorrRequest):
    try:
        a = np.asarray(req.seq_a, dtype=np.float64)
        b = np.asarray(req.seq_b, dtype=np.float64)
        return await asyncio.to_thread(
            corr_core.cross_correlation, a, b, req.normalize, req.max_lag
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
 
 
@app.post("/api/correlation/full")
async def correlation_full(req: FullCorrRequest):
    try:
        a = np.asarray(req.seq_a, dtype=np.float64)
        b = np.asarray(req.seq_b, dtype=np.float64)
        return await asyncio.to_thread(
            corr_core.full_correlation_analysis, a, b, req.max_lag
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
 
 
@app.post("/api/correlation/merit-sweep")
async def correlation_merit_sweep(req: MeritSweepRequest):
    try:
        params = np.linspace(req.param_min, req.param_max, req.n_params).tolist()
        return await asyncio.to_thread(
            corr_core.merit_factor_sweep,
            req.map_name, params, req.seq_length,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
 
 
@app.post("/api/correlation/ambiguity")
async def correlation_ambiguity(req: AmbiguityRequest):
    try:
        seq = np.asarray(req.sequence, dtype=np.float64)
        return await asyncio.to_thread(
            corr_core.ambiguity_function, seq, req.max_delay, req.n_doppler
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
 




# ===========================================================================
# SPECTRUM API
# ===========================================================================
 
class SpectrumRequest(BaseModel):
    signal: list[float]
    fs: float = 1.0
 
class SpectrumCompareRequest(BaseModel):
    map_configs: list[dict]
    seq_length: int = Field(512, ge=64, le=2048)
 
@app.get("/api/spectrum/explainers")
async def spectrum_explainers():
    return spec_core.get_spectrum_explainers()
 
@app.post("/api/spectrum/compute")
async def spectrum_compute(req: SpectrumRequest):
    try:
        x = np.asarray(req.signal, dtype=np.float64)
        return await asyncio.to_thread(spec_core.compute_spectrum, x, req.fs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
 
@app.post("/api/spectrum/compare")
async def spectrum_compare(req: SpectrumCompareRequest):
    try:
        return await asyncio.to_thread(
            spec_core.compare_maps_spectrum, req.map_configs, req.seq_length
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
 







 
# ===========================================================================
# BER API
# ===========================================================================
 
class BERCurvesRequest(BaseModel):
    ebn0_db_min: float = -5.0
    ebn0_db_max: float = 20.0
    n_points: int = Field(50, ge=10, le=200)
    rho: float = Field(0.0, ge=-1.0, le=1.0)
    beta: int = Field(40, ge=1, le=512)
 
class MonteCarloRequest(BaseModel):
    ebn0_db_min: float = 0.0
    ebn0_db_max: float = 15.0
    n_points: int = Field(12, ge=4, le=30)
    scheme: str = "dcsk"
    beta: int = Field(40, ge=1, le=256)
    rho: float = Field(0.0, ge=-1.0, le=1.0)
    n_bits: int = Field(1000, ge=100, le=5000)
 
@app.get("/api/ber/explainers")
async def ber_explainers():
    return ber_core.get_ber_explainers()
 
@app.post("/api/ber/curves")
async def ber_curves(req: BERCurvesRequest):
    try:
        ebn0 = np.linspace(req.ebn0_db_min, req.ebn0_db_max, req.n_points).tolist()
        return ber_core.all_ber_curves(ebn0, req.rho, req.beta)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
 
@app.post("/api/ber/monte-carlo")
async def ber_monte_carlo(req: MonteCarloRequest):
    try:
        ebn0 = np.linspace(req.ebn0_db_min, req.ebn0_db_max, req.n_points).tolist()

        sweep = await asyncio.to_thread(
            ber_core.monte_carlo_sweep,
            ebn0, req.scheme, req.beta, req.rho, req.n_bits,
        )

        mid_ebn0 = float((req.ebn0_db_min + req.ebn0_db_max) / 2.0)

        visual = await asyncio.to_thread(
            ber_core.monte_carlo_ber,
            mid_ebn0,
            req.scheme,
            req.beta,
            req.rho,
            req.n_bits,
            int(time.time() * 1e6) % (2**32),  # random seed each run
        )

        return {
            **sweep,
            "visual_ebn0_db": mid_ebn0,
            "z_values": visual.get("z_values", []),
            "detected_bits": visual.get("detected_bits", []),
            "true_bits": visual.get("true_bits", []),
            "n_errors": visual.get("n_errors", 0),
            "n_bits": visual.get("n_bits", req.n_bits),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
 








# ===========================================================================
# RADAR API
# ===========================================================================

@app.post("/api/radar/simulate")
async def radar_simulate(req: RadarRequest):
    try:
        return await asyncio.to_thread(
            radar_core.run_radar_simulation,
            req.length,
            req.delay,
            req.doppler,
            req.snr_db,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

@app.post("/api/radar/compare")
async def radar_compare(req: RadarRequest):
    try:
        return await asyncio.to_thread(
            radar_core.compare_radar_processors,
            req.length,
            req.delay,
            req.doppler,
            req.snr_db,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))




# ===========================================================================
# METRICS DASHBOARD API
# ===========================================================================

from core import metrics_dashboard as metrics_dash_core


class MetricsRequest(BaseModel):
    map_name: str = "logistic"
    n: int = Field(2048, ge=256, le=10000)
    x0: float = Field(0.31415, gt=0.0, lt=1.0)
    r: float = Field(3.9, ge=0.1, le=4.0)
    levels: int = Field(16, ge=2, le=256)


class MetricsCompareRequest(BaseModel):
    n: int = Field(2048, ge=256, le=10000)
    x0: float = Field(0.31415, gt=0.0, lt=1.0)
    r: float = Field(3.9, ge=0.1, le=4.0)
    levels: int = Field(16, ge=2, le=256)


@app.get("/api/metrics/explainers")
async def metrics_explainers():
    return metrics_dash_core.get_metrics_explainers()


@app.post("/api/metrics/analyze")
async def metrics_analyze(req: MetricsRequest):
    try:
        return await asyncio.to_thread(
            metrics_dash_core.analyze_map,
            req.map_name,
            req.n,
            req.x0,
            req.r,
            req.levels,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/metrics/compare")
async def metrics_compare(req: MetricsCompareRequest):
    try:
        return await asyncio.to_thread(
            metrics_dash_core.compare_maps,
            req.n,
            req.x0,
            req.r,
            req.levels,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
