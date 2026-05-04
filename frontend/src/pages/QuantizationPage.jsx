import { useEffect, useState } from "react";
import { useStore } from "../store/useStore.js";
import { postMapsOrbit } from "../api/client.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

import MapSelector           from "../components/controls/MapSelector.jsx";
import ParameterSlider       from "../components/controls/ParameterSlider.jsx";
import EquationDisplay       from "../components/math/EquationDisplay.jsx";
import LearnerCard           from "../components/math/LearnerCard.jsx";
import QuantizationChart     from "../components/charts/QuantizationChart.jsx";
import MSEComparisonChart    from "../components/charts/MSEComparisonChart.jsx";
import PDFOverlayChart       from "../components/charts/PDFOverlayChart.jsx";

/**
 * QuantizationPage — the bridge between chaos and digital communication.
 *
 * Layout:
 *   1. Hero + learner cards
 *   2. Controls: map, parameter, N levels, method selector
 *   3. Invariant measure (PDF) overlay — KDE + analytical
 *   4. Quantized signal: original vs quantized overlaid
 *   5. Lloyd-Max iteration history (when that method is selected)
 *   6. MSE comparison across all methods
 *   7. SQNR formula derivation + CSK relevance
 *   8. Concept explainer cards
 *
 * Data flow:
 *   1. Generate orbit → POST /api/maps/orbit
 *   2. Estimate PDF  → POST /api/quantization/estimate-pdf
 *   3. Quantize      → POST /api/quantization/quantize  (for each selected method)
 *   4. MSE compare   → POST /api/quantization/mse-comparison
 */

const API = "https://chaoscomm.onrender.com";

const METHODS = [
  { id: "uniform_midrise",  label: "Uniform (midrise)",  color: "cyan" },
  { id: "uniform_midtread", label: "Uniform (midtread)", color: "cyan" },
  { id: "mu_law",           label: "μ-law (μ=255)",      color: "purple" },
  { id: "a_law",            label: "A-law (A=87.6)",     color: "purple" },
  { id: "lloyd_max",        label: "Lloyd-Max optimal",  color: "amber" },
];

const LEVELS_OPTIONS = [2, 4, 8, 16, 32, 64];

function defaultParamsFor(meta) {
  if (!meta?.parameters) return {};
  return Object.fromEntries(meta.parameters.map(p => [p.name, p.default]));
}

export default function QuantizationPage() {
  const { mapsRegistry, mapsRegistryLoading, loadMapsRegistry, mapsRegistryError } = useStore();

  // Controls
  const [mapId, setMapId]       = useState("logistic");
  const [params, setParams]     = useState({ r: 3.9 });
  const [nLevels, setNLevels]   = useState(8);
  const [method, setMethod]     = useState("uniform_midrise");

  // Data
  const [orbit, setOrbit]           = useState(null);
  const [pdfData, setPdfData]       = useState(null);
  const [quantResult, setQuantResult] = useState(null);
  const [mseData, setMseData]       = useState(null);
  const [explainers, setExplainers] = useState(null);

  // Status
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => { loadMapsRegistry(); }, [loadMapsRegistry]);

  // Load explainers
  useEffect(() => {
    fetch(`${API}/api/quantization/explainers`)
      .then(r => r.json()).then(setExplainers).catch(() => {});
  }, []);

  // Reset on map change
  useEffect(() => {
    if (!mapsRegistry) return;
    const meta = mapsRegistry.maps[mapId];
    if (!meta) return;
    setParams(defaultParamsFor(meta));
    setOrbit(null); setPdfData(null); setQuantResult(null); setMseData(null);
  }, [mapId, mapsRegistry]);

  const dParams  = useDebouncedValue(params, 250);
  const dNLevels = useDebouncedValue(nLevels, 250);

  // Pipeline: orbit → PDF → quantize + MSE comparison
  useEffect(() => {
    if (!mapsRegistry) return;
    const meta = mapsRegistry.maps[mapId];
    if (!meta || meta.dimension !== 1) return;

    setBusy(true); setError(null);
    const domain = meta.domain;

    // Step 1: generate orbit
    postMapsOrbit({
      map: mapId,
      parameters: dParams,
      initial_state: [meta.default_x0 ?? 0.31415],
      n_samples: 2000,
    })
      .then(orbitData => {
        setOrbit(orbitData);
        const orbitArr = orbitData.orbit;

        // Step 2: estimate PDF
        return fetch(`${API}/api/quantization/estimate-pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orbit: orbitArr,
            map_name: mapId,
            parameters: dParams,
            domain: domain,
          }),
        }).then(r => r.json()).then(pdf => {
          setPdfData(pdf);
          return { orbitArr, pdf };
        });
      })
      .then(({ orbitArr, pdf }) => {
        // Step 3: quantize with selected method
        const quantReq = {
          orbit: orbitArr,
          method: method,
          n_levels: dNLevels,
          domain: meta.domain,
        };
        // For Lloyd-Max, supply the KDE PDF
        if (method === "lloyd_max" && pdf?.kde) {
          quantReq.pdf_x = pdf.kde.x;
          quantReq.pdf_density = pdf.kde.density;
        }

        // Step 4: MSE comparison (in parallel with quantization)
        const mseReq = {
          orbit: orbitArr.slice(0, 1000), // shorter orbit for speed
          levels_list: LEVELS_OPTIONS,
          methods: ["uniform_midrise", "mu_law", "lloyd_max"],
          domain: meta.domain,
        };
        if (pdf?.kde) {
          mseReq.pdf_x = pdf.kde.x;
          mseReq.pdf_density = pdf.kde.density;
        }

        return Promise.all([
          fetch(`${API}/api/quantization/quantize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(quantReq),
          }).then(r => r.json()),
          fetch(`${API}/api/quantization/mse-comparison`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(mseReq),
          }).then(r => r.json()),
        ]);
      })
      .then(([quant, mse]) => {
        setQuantResult(quant);
        setMseData(mse);
        setBusy(false);
      })
      .catch(e => {
        setError(e.message);
        setBusy(false);
      });
  }, [mapId, dParams, method, dNLevels, mapsRegistry]);

  // Gates
  if (mapsRegistryError) {
    return (
      <div className="px-8 py-8 max-w-6xl mx-auto">
        <div className="panel p-6 border-l-4 border-crimson/60">
          <div className="text-crimson font-semibold">Backend connection failed</div>
          <div className="text-sm text-ink-muted mt-1">{mapsRegistryError}</div>
        </div>
      </div>
    );
  }
  if (mapsRegistryLoading || !mapsRegistry) {
    return (
      <div className="px-8 py-8 max-w-6xl mx-auto">
        <div className="text-sm text-ink-muted animate-pulse-soft">Loading…</div>
      </div>
    );
  }

  const meta = mapsRegistry.maps[mapId];
  const domain = meta?.domain ?? [0, 1];

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">

      {/* ============== HERO ============== */}
      <section className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">
          MODULE · QUANTIZATION THEORY
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          Quantization — from continuous chaos to digital symbols
        </h1>
        <p className="text-ink-muted text-sm mb-4">
          Map every continuous chaotic sample to one of N discrete levels.
          The choice of quantizer determines how much chaos survives digitization.
        </p>
        <div className="flex gap-4 flex-wrap">
          <div className="px-4 py-2 rounded-md bg-bg-base/60 border border-bg-line">
            <EquationDisplay tex={"\\text{SQNR} = 6.02 \\cdot B + 1.76 \\;\\text{dB}"} block />
          </div>
          <div className="px-4 py-2 rounded-md bg-bg-base/60 border border-bg-line">
            <EquationDisplay tex={"\\text{MSE} = E\\!\\left[(x - Q(x))^2\\right]"} block />
          </div>
        </div>
      </section>

      {/* ============== LEARNER CARDS ============== */}
      {explainers && (
        <section className="space-y-4">
          <LearnerCard title="What is quantization and why do we need it?">
            <p>{explainers.what_is_quantization}</p>
          </LearnerCard>
          <LearnerCard title="The SQNR formula — 6 dB per bit" defaultOpen={false} icon="📐">
            <p>{explainers.sqnr_formula}</p>
          </LearnerCard>
        </section>
      )}

      {/* ============== CONTROLS ============== */}
      <section className="panel p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Map selector */}
          <MapSelector
            registry={{
              ...mapsRegistry,
              maps: Object.fromEntries(
                Object.entries(mapsRegistry.maps).filter(([, v]) => v.dimension === 1)
              ),
            }}
            value={mapId}
            onChange={setMapId}
          />

          {/* Parameter slider */}
          {meta?.parameters?.map(p => (
            <ParameterSlider
              key={p.name} spec={p}
              value={params[p.name] ?? p.default}
              onChange={v => setParams({ ...params, [p.name]: v })}
            />
          ))}

          {/* N levels */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-ink-dim">
                Quantization levels N
              </span>
              <span className="font-mono text-sm text-amber">{nLevels}</span>
            </div>
            <div className="flex gap-1.5">
              {LEVELS_OPTIONS.map(n => (
                <button
                  key={n}
                  onClick={() => setNLevels(n)}
                  className={[
                    "px-2.5 py-1.5 rounded text-xs font-mono",
                    n === nLevels
                      ? "bg-amber/20 text-amber border border-amber/40"
                      : "bg-bg-base border border-bg-line text-ink-muted hover:text-ink",
                  ].join(" ")}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-ink-dim mt-1 font-mono">
              {Math.ceil(Math.log2(nLevels))} bits per sample
            </div>
          </div>

          {/* Method selector */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1.5">
              Quantization method
            </div>
            <div className="space-y-1">
              {METHODS.map(m => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className={[
                    "block w-full text-left px-3 py-1.5 rounded text-xs",
                    m.id === method
                      ? m.color === "amber"
                        ? "bg-amber/15 text-amber border border-amber/40"
                        : m.color === "purple"
                          ? "bg-purple-500/15 text-purple-400 border border-purple-500/40"
                          : "bg-cyan/15 text-cyan border border-cyan/40"
                      : "bg-bg-base border border-bg-line text-ink-muted hover:text-ink",
                  ].join(" ")}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="mt-3 flex items-center gap-3 text-xs">
          {busy && <span className="caption-mono text-cyan animate-pulse-soft">computing…</span>}
          {error && <span className="caption-mono text-crimson">{error}</span>}
          {quantResult && (
            <span className="caption-mono">
              MSE = {quantResult.mse.toExponential(3)} · SQNR = {quantResult.sqnr_db.toFixed(1)} dB
              · {quantResult.n_bits} bits
              {quantResult.method === "lloyd_max" && ` · ${quantResult.iterations} iterations`}
              {quantResult.method === "lloyd_max" && (quantResult.converged ? " · converged ✓" : " · not converged")}
            </span>
          )}
        </div>
      </section>

      {/* ============== PDF + QUANTIZED SIGNAL ============== */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Invariant measure (PDF) */}
        <div className="panel p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink">Invariant measure (PDF)</div>
            <div className="caption-mono">
              this density determines the optimal Lloyd-Max boundaries
            </div>
          </div>
          <PDFOverlayChart pdfData={pdfData} domain={domain} />
        </div>

        {/* Quantized vs original */}
        <div className="panel p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink">
              Original vs quantized signal
            </div>
            <div className="caption-mono">
              {method.replace(/_/g, " ")} · N = {nLevels} levels · {quantResult?.n_bits ?? "?"} bits
            </div>
          </div>
          <QuantizationChart
            original={orbit?.orbit}
            quantized={quantResult?.quantized}
            levels={quantResult?.levels}
            domain={domain}
          />
        </div>
      </section>

      {/* ============== LLOYD-MAX ITERATION DETAIL ============== */}
      {method === "lloyd_max" && quantResult?.iteration_history && (
        <section className="panel p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink">Lloyd-Max convergence</div>
            <div className="caption-mono">
              MSE decreases with each iteration as boundaries and levels adjust
            </div>
          </div>

          {/* MSE per iteration mini-chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">
                MSE vs iteration
              </div>
              <div className="space-y-0.5">
                {quantResult.iteration_history.slice(0, 20).map((it, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="caption-mono w-8 text-right text-ink-dim">{i}</span>
                    <div className="flex-1 h-2 bg-bg-base rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber/60 rounded-full transition-all"
                        style={{
                          width: `${Math.max(2, (1 - it.mse / quantResult.iteration_history[0].mse) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="caption-mono w-24 text-right">{it.mse.toExponential(4)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">
                Final boundaries & levels
              </div>
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-ink-dim">
                    <th className="text-left py-1">Bin</th>
                    <th className="text-left py-1">Boundary</th>
                    <th className="text-left py-1">Level (centroid)</th>
                  </tr>
                </thead>
                <tbody>
                  {quantResult.levels.map((lv, i) => (
                    <tr key={i} className="border-t border-bg-line/50">
                      <td className="py-1 text-ink-dim">{i + 1}</td>
                      <td className="py-1 text-cyan">
                        [{quantResult.boundaries[i]?.toFixed(4)}, {quantResult.boundaries[i + 1]?.toFixed(4)})
                      </td>
                      <td className="py-1 text-amber">{lv.toFixed(5)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ============== MSE COMPARISON ============== */}
      <section className="panel p-5">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-ink">MSE comparison across methods</div>
            <div className="caption-mono">
              Lloyd-Max ≤ uniform always · gap widens for non-uniform PDFs
            </div>
          </div>
        </div>
        <MSEComparisonChart data={mseData} mode="mse" />
      </section>

      {/* ============== CONCEPT CARDS ============== */}
      {explainers && (
        <section className="space-y-3">
          <div className="section-title px-1">Deep dive</div>
          <LearnerCard title="Lloyd-Max — the optimal quantizer algorithm" defaultOpen={false} icon="⚙️">
            <p>{explainers.lloyd_max}</p>
          </LearnerCard>
          <LearnerCard title="μ-law companding" defaultOpen={false} icon="📞">
            <p>{explainers.mu_law}</p>
          </LearnerCard>
          <LearnerCard title="A-law companding" defaultOpen={false} icon="📞">
            <p>{explainers.a_law}</p>
          </LearnerCard>
          <LearnerCard title="Why quantization matters for CSK" defaultOpen={false} icon="⇄">
            <p>{explainers.quantization_for_csk}</p>
          </LearnerCard>
        </section>
      )}
    </div>
  );
}