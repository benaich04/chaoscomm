import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store/useStore.js";
import { postMapsOrbit, postMapsCobweb } from "../api/client.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

import MapSelector from "../components/controls/MapSelector.jsx";
import ParameterSlider from "../components/controls/ParameterSlider.jsx";
import CustomExpressionInput from "../components/controls/CustomExpressionInput.jsx";
import EquationDisplay from "../components/math/EquationDisplay.jsx";
import LearnerCard from "../components/math/LearnerCard.jsx";
import OrbitChart from "../components/charts/OrbitChart.jsx";
import CobwebChart from "../components/charts/CobwebChart.jsx";
import HistogramChart from "../components/charts/HistogramChart.jsx";

/**
 * ChaoticMapsPage — the first real interactive lab.
 *
 * Layout (top to bottom):
 *   1. Hero with map name, tier badge, governing equation in big KaTeX
 *   2. Three-layer learning stack:
 *        a. LearnerCard (plain-English, default open)
 *        b. Formal panel (equation, derivative, fixed points)
 *        c. Reference + CSK relevance
 *   3. Custom expression input (only when "custom" is selected)
 *   4. Controls panel (sliders) | Stats panel (Lyapunov, fixed points)
 *   5. Three charts in a grid: Orbit, Cobweb, Histogram
 *   6. Concept explainer cards (Lyapunov, fixed points, sensitivity)
 *
 * Every parameter change debounces for 250ms then re-fires both the
 * orbit and cobweb requests in parallel.
 */

// ---------- Helpers ----------------------------------------------------

function tierBadge(tier) {
  switch (tier) {
    case "tier1_textbook":
      return { label: "Textbook", color: "bg-cyan/15 text-cyan border-cyan/30" };
    case "tier2_research":
      return { label: "Research", color: "bg-amber/15 text-amber border-amber/30" };
    case "tier2_engineered":
      return { label: "Engineered (Zhou et al. 2014)", color: "bg-phosphor/15 text-phosphor border-phosphor/30" };
    case "tier3_custom":
      return { label: "User-defined", color: "bg-cyan/15 text-cyan border-cyan/30" };
    default:
      return { label: tier, color: "bg-bg-line text-ink-muted" };
  }
}

function defaultParametersFor(meta) {
  if (!meta || !meta.parameters) return {};
  const out = {};
  for (const p of meta.parameters) out[p.name] = p.default;
  return out;
}

function defaultInitialStateFor(meta) {
  if (meta?.dimension === 2) return [meta.default_x0 ?? 0.0, meta.default_y0 ?? 0.0];
  return [meta?.default_x0 ?? 0.31415];
}

// ---------- Page -------------------------------------------------------

export default function ChaoticMapsPage() {
  const { mapsRegistry, mapsRegistryLoading, loadMapsRegistry, mapsRegistryError } = useStore();

  // Local UI state — page-specific, doesn't need to live in Zustand.
  const [mapId, setMapId] = useState("logistic");
  const [params, setParams] = useState({ r: 3.9 });
  const [x0, setX0] = useState(0.31415);
  const [customExpr, setCustomExpr] = useState("");
  const [committedCustomExpr, setCommittedCustomExpr] = useState("");
  const [nSamples] = useState(2000);

  const [orbitData, setOrbitData] = useState(null);
  const [cobwebData, setCobwebData] = useState(null);
  const [computeError, setComputeError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Load registry on mount
  useEffect(() => { loadMapsRegistry(); }, [loadMapsRegistry]);

  // When the map selection changes, reset parameters and x0 to that map's defaults
  useEffect(() => {
    if (!mapsRegistry) return;
    if (mapId === "custom") {
      // Reasonable defaults for a custom map
      setParams({ r: 3.9 });
      setX0(0.31415);
      return;
    }
    const meta = mapsRegistry.maps[mapId];
    if (!meta) return;
    setParams(defaultParametersFor(meta));
    const init = defaultInitialStateFor(meta);
    setX0(init[0]);
  }, [mapId, mapsRegistry]);

  // Debounce parameter / x0 / custom changes
  const debouncedParams = useDebouncedValue(params, 250);
  const debouncedX0 = useDebouncedValue(x0, 250);
  const debouncedCustom = useDebouncedValue(committedCustomExpr, 0);

  // Fire the API calls in parallel when inputs settle
  useEffect(() => {
    if (!mapsRegistry) return;
    if (mapId === "custom" && !debouncedCustom) {
      setOrbitData(null); setCobwebData(null);
      return;
    }

    const meta = mapId === "custom" ? null : mapsRegistry.maps[mapId];
    const initial = mapId === "custom"
      ? [debouncedX0]
      : (meta?.dimension === 2 ? [debouncedX0, 0.0] : [debouncedX0]);

    const reqOrbit = {
      map: mapId,
      parameters: debouncedParams,
      initial_state: initial,
      n_samples: nSamples,
      ...(mapId === "custom" ? { custom_expression: debouncedCustom } : {}),
    };

    setBusy(true);
    setComputeError(null);

    const orbitPromise = postMapsOrbit(reqOrbit);

    // Cobweb: only for 1D maps (Henon doesn't have one)
    const wantsCobweb = mapId === "custom" || meta?.dimension === 1;
    const cobwebPromise = wantsCobweb
      ? postMapsCobweb({
          map: mapId,
          parameters: debouncedParams,
          x0: debouncedX0,
          n_steps: 60,
          ...(mapId === "custom" ? { custom_expression: debouncedCustom } : {}),
        })
      : Promise.resolve(null);

    Promise.all([orbitPromise, cobwebPromise])
      .then(([o, c]) => {
        setOrbitData(o);
        setCobwebData(c);
        setBusy(false);
      })
      .catch((e) => {
        setComputeError(e.message);
        setBusy(false);
      });
  }, [mapId, debouncedParams, debouncedX0, debouncedCustom, mapsRegistry, nSamples]);

  // ----- Loading / error gates -----
  if (mapsRegistryError) {
    return (
      <div className="px-8 py-8 max-w-6xl mx-auto">
        <div className="panel p-6 border-l-4 border-crimson/60">
          <div className="text-crimson font-semibold">Backend connection failed</div>
          <div className="text-sm text-ink-muted mt-1">{mapsRegistryError}</div>
          <div className="text-xs text-ink-dim mt-3">
            Is the FastAPI server running on localhost:8000?
          </div>
        </div>
      </div>
    );
  }
  if (mapsRegistryLoading || !mapsRegistry) {
    return (
      <div className="px-8 py-8 max-w-6xl mx-auto">
        <div className="text-sm text-ink-muted animate-pulse-soft">
          Loading chaotic-map registry…
        </div>
      </div>
    );
  }

  // ----- Resolve current map metadata -----
  const isCustom = mapId === "custom";
  const meta = isCustom ? null : mapsRegistry.maps[mapId];
  const displayName = isCustom ? "Custom Map" : (meta?.name ?? mapId);
  const tier = tierBadge(isCustom ? "tier3_custom" : meta?.tier);
  const equationLatex = isCustom
    ? (orbitData?.f_latex ? `x_{n+1} = ${orbitData.f_latex}` : "x_{n+1} = f(x_n)")
    : (meta?.expression_latex ?? "");
  const derivativeLatex = isCustom
    ? (orbitData?.f_prime_latex ? `f'(x) = ${orbitData.f_prime_latex}` : "")
    : (meta?.derivative_latex ?? "");
  const domain = isCustom ? [0, 1] : (meta?.domain ?? [0, 1]);
  const learnerText = isCustom
    ? mapsRegistry.custom.learner_explainer
    : (meta?.learner_explainer ?? "");
  const cskRelevance = meta?.csk_relevance;
  const reference = meta?.reference;

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">

      {/* ============== HERO ============== */}
      <section className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">
          MODULE · CHAOTIC MAP THEORY
        </div>
        <div className="flex items-baseline gap-3 mb-1">
          <span className={`pill border ${tier.color}`}>{tier.label}</span>
          {meta?.dimension === 2 && (
            <span className="pill border bg-amber/15 text-amber border-amber/30">2D</span>
          )}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">{displayName}</h1>
        <p className="text-ink-muted text-sm mb-5">
          Iterated map dynamics — orbit, fixed points, and chaos diagnostics.
        </p>
        {equationLatex && (
          <div className="mt-2 px-4 py-3 rounded-md bg-bg-base/60 border border-bg-line inline-block">
            <EquationDisplay tex={equationLatex} block className="text-ink" />
          </div>
        )}
      </section>

      {/* ============== THREE-LAYER LEARNING STACK ============== */}
      <section className="space-y-4">
        {learnerText && (
          <LearnerCard title={`What is the ${displayName}?`}>
            <p>{learnerText}</p>
          </LearnerCard>
        )}

        {/* Formal math panel */}
        <div className="panel p-6">
          <div className="section-title mb-3">Formal Definition</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">Map</div>
              <div className="px-3 py-2 rounded bg-bg-base/60 border border-bg-line">
                <EquationDisplay tex={equationLatex} block />
              </div>
            </div>
            {derivativeLatex && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">Derivative (used for λ)</div>
                <div className="px-3 py-2 rounded bg-bg-base/60 border border-bg-line">
                  <EquationDisplay tex={derivativeLatex} block />
                </div>
              </div>
            )}
          </div>
          {cskRelevance && (
            <div className="mt-4 pt-4 border-t border-bg-line">
              <div className="text-[10px] uppercase tracking-widest text-amber mb-1">
                Why this map matters for CSK
              </div>
              <p className="text-sm text-ink/90">{cskRelevance}</p>
            </div>
          )}
        </div>

        {reference && (
          <div className="caption-mono text-[11px] px-3">
            Reference: {reference}
          </div>
        )}
      </section>

      {/* ============== CUSTOM-EXPRESSION INPUT (custom map only) ============== */}
      {isCustom && (
        <section className="panel p-6">
          <div className="section-title mb-3">Define your map</div>
          <CustomExpressionInput
            meta={mapsRegistry.custom}
            value={committedCustomExpr}
            onCommit={(expr) => { setCustomExpr(expr); setCommittedCustomExpr(expr); }}
            serverError={computeError && computeError.toLowerCase().includes("expression") ? computeError : null}
          />
        </section>
      )}

      {/* ============== CONTROLS  +  STATS ============== */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls */}
        <div className="panel p-6 lg:col-span-1 space-y-5">
          <div className="section-title">Controls</div>

          <MapSelector
            registry={mapsRegistry}
            value={mapId}
            onChange={setMapId}
          />

          {/* Parameter sliders */}
          {!isCustom && meta?.parameters?.map((p) => (
            <ParameterSlider
              key={p.name}
              spec={p}
              value={params[p.name] ?? p.default}
              onChange={(v) => setParams({ ...params, [p.name]: v })}
            />
          ))}

          {/* For custom maps: show an r slider regardless (the parser will ignore it
              if the expression doesn't reference r) */}
          {isCustom && (
            <ParameterSlider
              spec={{ name: "r", label: "r", min: 0, max: 4, step: 0.001, default: 3.9 }}
              value={params.r ?? 3.9}
              onChange={(v) => setParams({ ...params, r: v })}
            />
          )}

          {/* Initial condition */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-ink-dim">
                Initial condition x₀
              </span>
              <span className="font-mono text-sm text-amber tabular-nums">
                {Number(x0).toFixed(5)}
              </span>
            </div>
            <input
              type="range"
              min={domain[0] + 0.001}
              max={domain[1] - 0.001}
              step={0.0001}
              value={x0}
              onChange={(e) => setX0(parseFloat(e.target.value))}
              className={[
                "w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line",
                "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5",
                "[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full",
                "[&::-webkit-slider-thumb]:bg-cyan",
                "[&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5",
                "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-cyan",
                "[&::-moz-range-thumb]:border-0",
              ].join(" ")}
            />
          </div>
        </div>

        {/* Stats panel */}
        <div className="panel p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="section-title">Diagnostics</div>
            {busy && (
              <span className="caption-mono text-cyan animate-pulse-soft">
                Computing…
              </span>
            )}
          </div>

          {computeError ? (
            <div className="text-sm text-crimson font-mono p-3 rounded bg-crimson/10 border border-crimson/30">
              {computeError}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Metric
                label="Lyapunov λ"
                value={orbitData?.lyapunov?.toFixed(4)}
                hint={orbitData?.lyapunov > 0 ? "λ > 0 → chaotic" : orbitData?.lyapunov < 0 ? "λ < 0 → stable" : "λ ≈ 0 → bifurcation"}
                hintColor={orbitData?.lyapunov > 0 ? "text-phosphor" : "text-amber"}
              />
              <Metric
                label="Method"
                value={orbitData?.lyapunov_method?.replace(/_/g, " ")}
                mono
              />
              <Metric
                label="Orbit length"
                value={orbitData?.orbit_full_length}
                mono
              />
              <Metric
                label="Fixed points"
                value={orbitData?.fixed_points?.length ?? 0}
              />
              <Metric
                label="Domain"
                value={`[${domain[0]}, ${domain[1]}]`}
                mono
              />
              {orbitData?.diagnostic && (
                <Metric
                  label="Status"
                  value={orbitData.diagnostic}
                  hintColor="text-crimson"
                  mono
                />
              )}
            </div>
          )}

          {/* Fixed-points table */}
          {orbitData?.fixed_points?.length > 0 && (
            <div className="mt-4 pt-4 border-t border-bg-line">
              <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">
                Fixed points (analytical)
              </div>
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-ink-dim">
                    <th className="text-left py-1">x*</th>
                    <th className="text-left py-1">f'(x*)</th>
                    <th className="text-left py-1">Stability</th>
                  </tr>
                </thead>
                <tbody>
                  {orbitData.fixed_points.map((fp, i) => (
                    <tr key={i} className="border-t border-bg-line/50">
                      <td className="py-1 text-ink">{fp.x.toFixed(6)}</td>
                      <td className="py-1 text-ink-muted">{fp.multiplier.toFixed(4)}</td>
                      <td className={[
                        "py-1 font-medium",
                        fp.stability === "stable" ? "text-phosphor" :
                        fp.stability === "unstable" ? "text-crimson" : "text-amber",
                      ].join(" ")}>
                        {fp.stability}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ============== CHARTS ============== */}
      <section className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Orbit */}
          <div className="panel p-5">
            <div className="flex items-baseline justify-between mb-2">
              <div>
                <div className="text-sm font-semibold text-ink">Orbit</div>
                <div className="caption-mono">x_n vs n &nbsp;·&nbsp; first 600 samples</div>
              </div>
            </div>
            <OrbitChart
              orbit={orbitData?.dimension === 2 ? orbitData?.orbit_x : orbitData?.orbit}
              domain={domain}
              showFirst={600}
            />
          </div>

          {/* Histogram (invariant measure) */}
          <div className="panel p-5">
            <div className="flex items-baseline justify-between mb-2">
              <div>
                <div className="text-sm font-semibold text-ink">Empirical density</div>
                <div className="caption-mono">approximates the invariant measure</div>
              </div>
            </div>
            <HistogramChart
              orbit={orbitData?.dimension === 2 ? orbitData?.orbit_x : orbitData?.orbit}
              domain={domain}
            />
          </div>
        </div>

        {/* Cobweb (1D only) */}
        {(meta?.dimension === 1 || isCustom) && (
          <div className="panel p-5">
            <div className="flex items-baseline justify-between mb-2">
              <div>
                <div className="text-sm font-semibold text-ink">Cobweb diagram</div>
                <div className="caption-mono">geometric view of the iteration starting from x₀</div>
              </div>
            </div>
            <CobwebChart data={cobwebData} domain={domain} />
          </div>
        )}
      </section>

      {/* ============== CONCEPT EXPLAINERS ============== */}
      <section className="space-y-3">
        <div className="section-title px-1">Foundational concepts</div>
        <LearnerCard title="What is the Lyapunov exponent?" defaultOpen={false} icon="λ">
          <p>{mapsRegistry.concepts.lyapunov}</p>
        </LearnerCard>
        <LearnerCard title="Fixed points and stability" defaultOpen={false} icon="◎">
          <p>{mapsRegistry.concepts.fixed_points}</p>
          <p className="mt-2">{mapsRegistry.concepts.stability}</p>
        </LearnerCard>
        <LearnerCard title="Sensitivity to initial conditions" defaultOpen={false} icon="🦋">
          <p>{mapsRegistry.concepts.sensitivity_to_initial_conditions}</p>
        </LearnerCard>
        <LearnerCard title="The invariant measure" defaultOpen={false} icon="∫">
          <p>{mapsRegistry.concepts.invariant_measure}</p>
        </LearnerCard>
        <LearnerCard title="Why does chaos matter for CSK?" defaultOpen={false} icon="⇄">
          <p>{mapsRegistry.concepts.chaos_and_csk}</p>
        </LearnerCard>
      </section>
    </div>
  );
}

// ---------- Tiny helper component -----------------------------------------

function Metric({ label, value, hint, hintColor = "text-ink-muted", mono = false }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">{label}</div>
      <div className={[
        "text-base font-semibold tabular-nums",
        mono ? "font-mono" : "",
        "text-ink",
      ].join(" ")}>
        {value === undefined || value === null ? "—" : value}
      </div>
      {hint && <div className={`text-[11px] mt-0.5 ${hintColor}`}>{hint}</div>}
    </div>
  );
}