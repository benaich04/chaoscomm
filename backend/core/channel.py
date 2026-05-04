"""
core/channel.py — Channel models for ChaosComm.

This module sits between modulation and detection:

    transmitted waveform s[n] → CHANNEL → received waveform r[n]

Implemented channel methods:

1. ideal
   r[n] = s[n]

2. awgn
   r[n] = s[n] + w[n]

3. flat_fading
   r[n] = h s[n] + w[n]

4. rayleigh
   r[n] = h[n] s[n] + w[n], h Rayleigh-distributed

5. rician
   r[n] = h[n] s[n] + w[n], h has LOS + scattered component

6. multipath
   r[n] = Σ a_k s[n-d_k] + w[n]

7. jammer
   r[n] = s[n] + j[n] + w[n]

The goal is not to perfectly model every physical wireless channel.
The goal is to give the frontend a clean educational simulator that shows
how different impairments damage a chaotic communication waveform.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np


# ===========================================================================
# CONCEPT EXPLAINERS
# ===========================================================================

CHANNEL_EXPLAINERS: dict[str, str] = {
    "channel_overview": (
        "A channel is the real-world path between the transmitter and receiver. "
        "In an ideal simulation, the received signal equals the transmitted signal. "
        "In reality, the waveform is corrupted by noise, fading, echoes, and "
        "intentional interference. The channel page shows how each impairment "
        "changes the waveform and affects detection."
    ),
    "ideal_channel": (
        "The ideal channel is the baseline: r[n] = s[n]. Nothing is added, scaled, "
        "or delayed. If the receiver fails here, the modulation/detection pipeline "
        "itself has a bug. For ChaosComm, the ideal channel proves that CSK, DCSK, "
        "and FM-DCSK work before we add real-world damage."
    ),
    "awgn": (
        "AWGN means Additive White Gaussian Noise. Additive means the noise is added "
        "to the signal. White means it has equal power across frequency. Gaussian "
        "means the noise samples follow a normal distribution. This is the standard "
        "first channel model in communication theory because it isolates the effect "
        "of random thermal noise."
    ),
    "flat_fading": (
        "Flat fading multiplies the whole signal by a channel gain h. If h is small, "
        "the received signal becomes weak and harder to detect. This models slow "
        "shadowing or amplitude loss where all frequencies are affected equally."
    ),
    "rayleigh": (
        "Rayleigh fading models a wireless environment with many scattered paths and "
        "no strong line-of-sight path. The channel gain randomly dips, sometimes very "
        "deeply. These deep fades can cause burst errors even when the average SNR "
        "looks acceptable."
    ),
    "rician": (
        "Rician fading models a channel with one strong line-of-sight component plus "
        "many scattered components. The K-factor controls how dominant the direct path "
        "is. Large K behaves more like a stable channel; small K approaches Rayleigh."
    ),
    "multipath": (
        "Multipath means the receiver sees delayed echoes of the transmitted waveform. "
        "The received signal is a sum of delayed copies. This can smear the waveform "
        "and create inter-symbol interference, especially when the delays are comparable "
        "to the chip or bit duration."
    ),
    "jamming": (
        "Jamming is intentional interference. A jammer may transmit a tone, broadband "
        "noise, pulses, or a chirp to confuse the receiver. Chaotic spreading helps "
        "because correlation/matched filtering gives processing gain, but strong jamming "
        "can still increase BER."
    ),
    "snr_jsr": (
        "SNR is signal-to-noise ratio: higher SNR means cleaner reception. JSR is "
        "jammer-to-signal ratio: higher JSR means stronger interference relative to "
        "the useful signal. In the frontend, SNR controls random noise while JSR controls "
        "intentional jammer strength."
    ),
}


# ===========================================================================
# HELPERS
# ===========================================================================

def _as_float_array(waveform: Any) -> np.ndarray:
    """Convert user input into a finite 1-D float64 NumPy array."""
    x = np.asarray(waveform, dtype=np.float64).flatten()
    if x.size == 0:
        raise ValueError("waveform must contain at least one sample")
    if not np.all(np.isfinite(x)):
        raise ValueError("waveform contains NaN or Inf")
    return x


def _rng(seed: int | None = None) -> np.random.Generator:
    """Deterministic when seed is supplied; random otherwise."""
    return np.random.default_rng(seed)


def _power(x: np.ndarray) -> float:
    """Average signal power."""
    if x.size == 0:
        return 0.0
    return float(np.mean(np.asarray(x, dtype=np.float64) ** 2))


def _db_to_linear(db: float) -> float:
    return float(10.0 ** (db / 10.0))


def _linear_to_db(x: float) -> float:
    if x <= 1e-12:
        return -120.0   # effectively -∞ but JSON-safe
    return float(10.0 * math.log10(x))

def _json_safe(value: Any) -> Any:
    """Recursively convert NaN/Inf NumPy/Python values into JSON-safe numbers."""
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    if isinstance(value, np.ndarray):
        return _json_safe(value.tolist())
    if isinstance(value, (np.floating, float)):
        v = float(value)
        if math.isnan(v):
            return 0.0
        if math.isinf(v):
            return 120.0 if v > 0 else -120.0
        return v
    if isinstance(value, (np.integer, int)):
        return int(value)
    return value


def _add_awgn(
    signal: np.ndarray,
    snr_db: float | None,
    seed: int | None = None,
) -> tuple[np.ndarray, np.ndarray, dict[str, float]]:
    """
    Add AWGN at a requested SNR.

    SNR = signal_power / noise_power

    If snr_db is None, no noise is added.
    """
    s = _as_float_array(signal)

    if snr_db is None:
        noise = np.zeros_like(s)
        return s.copy(), noise, {
            "signal_power": _power(s),
            "noise_power": 0.0,
            "snr_db_requested": 120.0,
            "snr_db_measured": 120.0,
        }

    sig_power = _power(s)

    if sig_power <= 0:
        noise_power = 0.0
        noise = np.zeros_like(s)
    else:
        snr_linear = _db_to_linear(float(snr_db))
        noise_power = sig_power / snr_linear
        noise_std = math.sqrt(noise_power)
        noise = _rng(seed).normal(0.0, noise_std, size=s.shape)

    y = s + noise
    measured_noise_power = _power(noise)
    measured_snr = sig_power / measured_noise_power if measured_noise_power > 0 else 1e12

    return y, noise, {
        "signal_power": sig_power,
        "noise_power": measured_noise_power,
        "snr_db_requested": float(snr_db),
        "snr_db_measured": _linear_to_db(measured_snr),
    }


def _base_response(
    channel_type: str,
    transmitted: np.ndarray,
    received: np.ndarray,
    impairment: np.ndarray | None = None,
    fading: np.ndarray | None = None,
    impulse_response: np.ndarray | None = None,
    extra_metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Standard response shape for all channel methods."""
    tx_power = _power(transmitted)
    rx_power = _power(received)

    if impairment is None:
        impairment = received - transmitted

    impairment_power = _power(impairment)
    effective_snr = tx_power / impairment_power if impairment_power > 0 else 1e12

    metrics: dict[str, Any] = {
        "tx_power": tx_power,
        "rx_power": rx_power,
        "impairment_power": impairment_power,
        "effective_snr_db": _linear_to_db(effective_snr),
        "n_samples": int(len(transmitted)),
    }

    if extra_metrics:
        metrics.update(extra_metrics)

    out: dict[str, Any] = {
        "channel_type": channel_type,
        "transmitted": transmitted.tolist(),
        "received": received.tolist(),
        "impairment": impairment.tolist(),
        "metrics": metrics,
    }

    if fading is not None:
        out["fading"] = fading.tolist()

    if impulse_response is not None:
        out["impulse_response"] = impulse_response.tolist()

    return _json_safe(out)


# ===========================================================================
# 1. IDEAL CHANNEL
# ===========================================================================

def ideal_channel(waveform: Any) -> dict[str, Any]:
    """Ideal channel: r[n] = s[n]."""
    s = _as_float_array(waveform)
    y = s.copy()
    impairment = np.zeros_like(s)

    return _base_response(
        channel_type="ideal",
        transmitted=s,
        received=y,
        impairment=impairment,
        extra_metrics={
            "description": "No channel impairment applied.",
        },
    )


# ===========================================================================
# 2. AWGN CHANNEL
# ===========================================================================

def awgn_channel(
    waveform: Any,
    snr_db: float = 20.0,
    seed: int | None = None,
) -> dict[str, Any]:
    """AWGN channel: r[n] = s[n] + w[n]."""
    s = _as_float_array(waveform)
    y, noise, noise_metrics = _add_awgn(s, snr_db, seed)

    return _base_response(
        channel_type="awgn",
        transmitted=s,
        received=y,
        impairment=noise,
        extra_metrics={
            **noise_metrics,
            "description": "Additive white Gaussian noise channel.",
        },
    )


# ===========================================================================
# 3. FLAT FADING CHANNEL
# ===========================================================================

def flat_fading_channel(
    waveform: Any,
    gain: float = 1.0,
    snr_db: float | None = None,
    seed: int | None = None,
) -> dict[str, Any]:
    """
    Flat fading channel: r[n] = h s[n] + w[n].

    gain = h.
    """
    s = _as_float_array(waveform)
    h = float(gain)

    faded = h * s
    y, noise, noise_metrics = _add_awgn(faded, snr_db, seed)

    impairment = y - s
    fading = np.full_like(s, h, dtype=np.float64)

    return _base_response(
        channel_type="flat_fading",
        transmitted=s,
        received=y,
        impairment=impairment,
        fading=fading,
        extra_metrics={
            **noise_metrics,
            "gain": h,
            "description": "Constant multiplicative channel gain plus optional AWGN.",
        },
    )


# ===========================================================================
# 4. RAYLEIGH FADING CHANNEL
# ===========================================================================

def rayleigh_fading_channel(
    waveform: Any,
    snr_db: float | None = None,
    seed: int | None = None,
    block_fading: bool = False,
) -> dict[str, Any]:
    """
    Rayleigh fading channel.

    If block_fading=True:
        one Rayleigh gain is used for the whole waveform.

    If block_fading=False:
        each sample gets its own Rayleigh gain.
    """
    s = _as_float_array(waveform)
    rng = _rng(seed)

    if block_fading:
        h0 = float(rng.rayleigh(scale=1.0 / math.sqrt(2.0)))
        h = np.full_like(s, h0)
    else:
        # scale = 1/sqrt(2) gives E[h^2] ≈ 1.
        h = rng.rayleigh(scale=1.0 / math.sqrt(2.0), size=s.shape)

    faded = h * s
    y, noise, noise_metrics = _add_awgn(faded, snr_db, None if seed is None else seed + 1)

    impairment = y - s

    return _base_response(
        channel_type="rayleigh",
        transmitted=s,
        received=y,
        impairment=impairment,
        fading=h,
        extra_metrics={
            **noise_metrics,
            "block_fading": bool(block_fading),
            "mean_gain": float(np.mean(h)),
            "mean_gain_power": float(np.mean(h ** 2)),
            "min_gain": float(np.min(h)),
            "max_gain": float(np.max(h)),
            "description": "Rayleigh fading plus optional AWGN.",
        },
    )


# ===========================================================================
# 5. RICIAN FADING CHANNEL
# ===========================================================================

def rician_fading_channel(
    waveform: Any,
    k_factor: float = 5.0,
    snr_db: float | None = None,
    seed: int | None = None,
    block_fading: bool = False,
) -> dict[str, Any]:
    """
    Rician fading channel.

    K-factor = LOS power / scattered power.

    Large K  → strong line-of-sight, more stable channel.
    Small K  → approaches Rayleigh fading.
    """
    s = _as_float_array(waveform)
    K = max(float(k_factor), 0.0)
    rng = _rng(seed)

    n = 1 if block_fading else len(s)

    # Complex Rician coefficient:
    # h = sqrt(K/(K+1))*1 + sqrt(1/(K+1))*complex_gaussian
    los = math.sqrt(K / (K + 1.0)) if K > 0 else 0.0
    scatter_scale = math.sqrt(1.0 / (K + 1.0))

    real = rng.normal(0.0, 1.0 / math.sqrt(2.0), size=n)
    imag = rng.normal(0.0, 1.0 / math.sqrt(2.0), size=n)

    h_complex = los + scatter_scale * (real + 1j * imag)
    h_amp = np.abs(h_complex)

    if block_fading:
        h = np.full_like(s, float(h_amp[0]))
    else:
        h = h_amp.astype(np.float64)

    faded = h * s
    y, noise, noise_metrics = _add_awgn(faded, snr_db, None if seed is None else seed + 1)

    impairment = y - s

    return _base_response(
        channel_type="rician",
        transmitted=s,
        received=y,
        impairment=impairment,
        fading=h,
        extra_metrics={
            **noise_metrics,
            "k_factor": K,
            "block_fading": bool(block_fading),
            "mean_gain": float(np.mean(h)),
            "mean_gain_power": float(np.mean(h ** 2)),
            "min_gain": float(np.min(h)),
            "max_gain": float(np.max(h)),
            "description": "Rician fading with line-of-sight component plus optional AWGN.",
        },
    )


# ===========================================================================
# 6. MULTIPATH CHANNEL
# ===========================================================================

def multipath_channel(
    waveform: Any,
    delays: list[int] | None = None,
    gains: list[float] | None = None,
    snr_db: float | None = None,
    seed: int | None = None,
) -> dict[str, Any]:
    """
    Multipath channel:

        r[n] = Σ a_k s[n - d_k] + w[n]

    delays must be nonnegative integer sample delays.
    gains must have same length as delays.
    """
    s = _as_float_array(waveform)

    if delays is None:
        delays = [0, 3, 8]
    if gains is None:
        gains = [1.0, 0.45, 0.2]

    if len(delays) != len(gains):
        raise ValueError("delays and gains must have the same length")
    if len(delays) == 0:
        raise ValueError("multipath requires at least one path")

    delays_i = [int(d) for d in delays]
    gains_f = [float(g) for g in gains]

    if any(d < 0 for d in delays_i):
        raise ValueError("multipath delays must be nonnegative")
    if not all(math.isfinite(g) for g in gains_f):
        raise ValueError("multipath gains must be finite")

    max_delay = max(delays_i)
    h = np.zeros(max_delay + 1, dtype=np.float64)

    for d, g in zip(delays_i, gains_f):
        h[d] += g

    convolved = np.convolve(s, h, mode="full")[: len(s)]
    y, noise, noise_metrics = _add_awgn(convolved, snr_db, seed)

    impairment = y - s

    return _base_response(
        channel_type="multipath",
        transmitted=s,
        received=y,
        impairment=impairment,
        impulse_response=h,
        extra_metrics={
            **noise_metrics,
            "delays": delays_i,
            "gains": gains_f,
            "max_delay": int(max_delay),
            "n_paths": int(len(delays_i)),
            "description": "Delayed echo channel plus optional AWGN.",
        },
    )


# ===========================================================================
# 7. JAMMER CHANNEL
# ===========================================================================

def _make_jammer(
    n: int,
    signal_power: float,
    jsr_db: float,
    jammer_type: str = "tone",
    fs: float = 1.0,
    freq: float = 0.05,
    seed: int | None = None,
    duty_cycle: float = 0.25,
    chirp_f0: float = 0.02,
    chirp_f1: float = 0.25,
) -> np.ndarray:
    """
    Generate jammer with requested jammer-to-signal ratio.

    JSR = jammer_power / signal_power.
    """
    if n <= 0:
        raise ValueError("n must be positive")

    rng = _rng(seed)
    jsr_linear = _db_to_linear(float(jsr_db))
    target_power = signal_power * jsr_linear

    if target_power <= 0:
        return np.zeros(n, dtype=np.float64)

    t = np.arange(n, dtype=np.float64) / float(fs)

    jammer_type = jammer_type.lower().strip()

    if jammer_type == "tone":
        raw = np.sin(2.0 * math.pi * float(freq) * t)

    elif jammer_type == "broadband":
        raw = rng.normal(0.0, 1.0, size=n)

    elif jammer_type == "pulsed":
        duty = min(max(float(duty_cycle), 0.01), 1.0)
        raw_noise = rng.normal(0.0, 1.0, size=n)

        # Period chosen to make a visually clear pulse train.
        period = max(8, n // 12)
        active = (np.arange(n) % period) < int(period * duty)
        raw = raw_noise * active.astype(np.float64)

    elif jammer_type == "chirp":
        f0 = float(chirp_f0)
        f1 = float(chirp_f1)
        duration = max(t[-1], 1.0 / float(fs))
        k = (f1 - f0) / duration
        phase = 2.0 * math.pi * (f0 * t + 0.5 * k * t ** 2)
        raw = np.sin(phase)

    else:
        raise ValueError(
            "jammer_type must be one of: tone, broadband, pulsed, chirp"
        )

    raw_power = _power(raw)

    if raw_power <= 0:
        return np.zeros(n, dtype=np.float64)

    scale = math.sqrt(target_power / raw_power)
    return scale * raw


def jammer_channel(
    waveform: Any,
    jammer_type: str = "tone",
    jsr_db: float = 0.0,
    snr_db: float | None = None,
    fs: float = 1.0,
    freq: float = 0.05,
    seed: int | None = None,
    duty_cycle: float = 0.25,
    chirp_f0: float = 0.02,
    chirp_f1: float = 0.25,
) -> dict[str, Any]:
    """
    Jamming channel:

        r[n] = s[n] + j[n] + w[n]
    """
    s = _as_float_array(waveform)
    sig_power = _power(s)

    jammer = _make_jammer(
        n=len(s),
        signal_power=sig_power,
        jsr_db=jsr_db,
        jammer_type=jammer_type,
        fs=fs,
        freq=freq,
        seed=seed,
        duty_cycle=duty_cycle,
        chirp_f0=chirp_f0,
        chirp_f1=chirp_f1,
    )

    jammed = s + jammer
    y, noise, noise_metrics = _add_awgn(jammed, snr_db, None if seed is None else seed + 1)

    total_impairment = y - s
    jammer_power = _power(jammer)
    measured_jsr = jammer_power / sig_power if sig_power > 0 else 1e12

    result = _base_response(
        channel_type="jammer",
        transmitted=s,
        received=y,
        impairment=total_impairment,
        extra_metrics={
            **noise_metrics,
            "jammer_type": jammer_type,
            "jammer_power": jammer_power,
            "jsr_db_requested": float(jsr_db),
            "jsr_db_measured": _linear_to_db(measured_jsr),
            "fs": float(fs),
            "freq": float(freq),
            "duty_cycle": float(duty_cycle),
            "chirp_f0": float(chirp_f0),
            "chirp_f1": float(chirp_f1),
            "description": "Intentional interference plus optional AWGN.",
        },
    )

    result["jammer"] = jammer.tolist()
    result["noise"] = noise.tolist()

    return result


# ===========================================================================
# DISPATCHER
# ===========================================================================

def apply_channel(
    waveform: Any,
    channel_type: str = "ideal",
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    General dispatcher used by the FastAPI endpoint.

    channel_type:
        ideal
        awgn
        flat_fading
        rayleigh
        rician
        multipath
        jammer
    """
    params = params or {}
    ch = channel_type.lower().strip()

    if ch == "ideal":
        return ideal_channel(waveform)

    if ch == "awgn":
        return awgn_channel(
            waveform,
            snr_db=float(params.get("snr_db", 20.0)),
            seed=params.get("seed"),
        )

    if ch == "flat_fading":
        return flat_fading_channel(
            waveform,
            gain=float(params.get("gain", 1.0)),
            snr_db=params.get("snr_db"),
            seed=params.get("seed"),
        )

    if ch == "rayleigh":
        return rayleigh_fading_channel(
            waveform,
            snr_db=params.get("snr_db"),
            seed=params.get("seed"),
            block_fading=bool(params.get("block_fading", False)),
        )

    if ch == "rician":
        return rician_fading_channel(
            waveform,
            k_factor=float(params.get("k_factor", 5.0)),
            snr_db=params.get("snr_db"),
            seed=params.get("seed"),
            block_fading=bool(params.get("block_fading", False)),
        )

    if ch == "multipath":
        return multipath_channel(
            waveform,
            delays=params.get("delays", [0, 3, 8]),
            gains=params.get("gains", [1.0, 0.45, 0.2]),
            snr_db=params.get("snr_db"),
            seed=params.get("seed"),
        )

    if ch == "jammer":
        return jammer_channel(
            waveform,
            jammer_type=params.get("jammer_type", "tone"),
            jsr_db=float(params.get("jsr_db", 0.0)),
            snr_db=params.get("snr_db"),
            fs=float(params.get("fs", 1.0)),
            freq=float(params.get("freq", 0.05)),
            seed=params.get("seed"),
            duty_cycle=float(params.get("duty_cycle", 0.25)),
            chirp_f0=float(params.get("chirp_f0", 0.02)),
            chirp_f1=float(params.get("chirp_f1", 0.25)),
        )

    raise ValueError(
        "channel_type must be one of: ideal, awgn, flat_fading, "
        "rayleigh, rician, multipath, jammer"
    )


def compare_channels(
    waveform: Any,
    channel_specs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Apply multiple channels to the same waveform.

    Useful for frontend comparison panels:
        ideal vs AWGN vs Rayleigh vs multipath vs jammer
    """
    s = _as_float_array(waveform)

    if channel_specs is None:
        channel_specs = [
            {"channel_type": "ideal", "params": {}},
            {"channel_type": "awgn", "params": {"snr_db": 10.0, "seed": 1}},
            {"channel_type": "rayleigh", "params": {"snr_db": 15.0, "seed": 2}},
            {"channel_type": "multipath", "params": {"delays": [0, 3, 8], "gains": [1.0, 0.45, 0.2]}},
            {"channel_type": "jammer", "params": {"jammer_type": "tone", "jsr_db": 0.0, "freq": 0.05, "seed": 3}},
        ]

    results = []

    for spec in channel_specs:
        ch = spec.get("channel_type", "ideal")
        params = spec.get("params", {})
        result = apply_channel(s, ch, params)

        # For comparison panels, avoid returning massive duplicate tx arrays each time.
        compact = {
            "channel_type": result["channel_type"],
            "received": result["received"],
            "impairment": result["impairment"],
            "metrics": result["metrics"],
        }

        if "fading" in result:
            compact["fading"] = result["fading"]
        if "impulse_response" in result:
            compact["impulse_response"] = result["impulse_response"]
        if "jammer" in result:
            compact["jammer"] = result["jammer"]

        results.append(compact)

    return _json_safe({
    "transmitted": s.tolist(),
    "tx_power": _power(s),
    "n_samples": int(len(s)),
    "results": results,
})


def get_channel_explainers() -> dict[str, str]:
    return CHANNEL_EXPLAINERS