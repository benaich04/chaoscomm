import { useEffect, useState } from "react";
import { useStore } from "../store/useStore.js";
import { postMapsOrbit } from "../api/client.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

import MapSelector           from "../components/controls/MapSelector.jsx";
import ParameterSlider       from "../components/controls/ParameterSlider.jsx";
import EquationDisplay       from "../components/math/EquationDisplay.jsx";
import LearnerCard           from "../components/math/LearnerCard.jsx";
import ReturnMapChart        from "../components/charts/ReturnMapChart.jsx";
import HenonAttractorChart   from "../components/charts/HenonAttractorChart.jsx";
import SensitivityDemoChart  from "../components/charts/SensitivityDemoChart.jsx";
import OrbitChart            from "../components/charts/OrbitChart.jsx";

/**
 * PhasePage — the geometry of chaos.
 *
 * Layout:
 *
 *   1. Hero + learner cards
 *   2. Controls: map selector, parameter slider, x₀ slider
 *   3. Main visualization:
 *        - 1D maps → Return Map (xₙ, xₙ₊₁) + orbit time series
 *        - 2D maps (Hénon) → Strange Attractor (xₙ, yₙ) with click-to-zoom
 *   4. Sensitivity-to-initial-conditions demo:
 *        - ε slider (log scale: 10⁻¹⁶ to 10⁻¹)
 *        - Two orbits overlaid
 *        - log₁₀|Δxₙ| divergence chart with theoretical slope line
 *   5. Concept explainer cards
 */

function defaultParametersFor(meta) {
  if (!meta?.parameters) return {};
  return Object.fromEntries(meta.parameters.map(p => [p.name, p.default]));
}

export default function PhasePage() {
  const { mapsRegistry, mapsRegistryLoading, loadMapsRegistry, mapsRegistryError } = useStore();

  const [mapId, setMapId]       = useState("logistic");
  const [params, setParams]     = useState({ r: 3.9 });
  const [x0, setX0]             = useState(0.31415);
  const [logEps, setLogEps]     = useState(-10);  // log₁₀(ε)

  const [orbitData, setOrbitData]       = useState(null);
  const [orbitDataB, setOrbitDataB]     = useState(null); // second orbit for sensitivity
  const [busy, setBusy]                 = useState(false);
  const [error, setError]               = useState(null);

  useEffect(() => { loadMapsRegistry(); }, [loadMapsRegistry]);

  // Reset params + x0 on map change
  useEffect(() => {
    if (!mapsRegistry) return;
    if (mapId === "custom") return;
    const meta = mapsRegistry.maps[mapId];
    if (!meta) return;
    setParams(defaultParametersFor(meta));
    setX0(meta.default_x0 ?? 0.31415);
    setOrbitData(null);
    setOrbitDataB(null);
  }, [mapId, mapsRegistry]);

  const dParams = useDebouncedValue(params, 250);
  const dX0     = useDebouncedValue(x0, 250);
  const dLogEps = useDebouncedValue(logEps, 250);

  // Fire two orbit requests in parallel: orbit A (x0) and orbit B (x0 + ε)
  useEffect(() => {
    if (!mapsRegistry) return;
    const meta = mapsRegistry.maps[mapId];
    if (!meta) return;

    const epsilon = Math.pow(10, dLogEps);
    const is2D = meta.dimension === 2;
    const initA = is2D ? [dX0, 0.0] : [dX0];
    const initB = is2D ? [dX0 + epsilon, 0.0] : [dX0 + epsilon];
    const nSamples = is2D ? 10000 : 2000;

    setBusy(true);
    setError(null);

    const reqBase = { map: mapId, parameters: dParams, n_samples: nSamples };

    Promise.all([
      postMapsOrbit({ ...reqBase, initial_state: initA }),
      postMapsOrbit({ ...reqBase, initial_state: initB }),
    ])
      .then(([a, b]) => {
        setOrbitData(a);
        setOrbitDataB(b);
        setBusy(false);
      })
      .catch((e) => {
        setError(e.message);
        setBusy(false);
      });
  }, [mapId, dParams, dX0, dLogEps, mapsRegistry]);

  // ---- Gates ----
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
  const is2D = meta?.dimension === 2;
  const domain = meta?.domain ?? [0, 1];
  const epsilon = Math.pow(10, logEps);

  // Extract 1D orbits
  const orbitA = is2D ? orbitData?.orbit_x : orbitData?.orbit;
  const orbitB = is2D ? orbitDataB?.orbit_x : orbitDataB?.orbit;

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">

      {/* ============== HERO ============== */}
      <section className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">
          MODULE · PHASE PORTRAITS
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          Phase portraits & sensitivity demo
        </h1>
        <p className="text-ink-muted text-sm mb-5">
          See the geometric structure of chaos — return maps, strange attractors,
          and the butterfly effect in real time.
        </p>
        {meta?.expression_latex && (
          <div className="mt-2 px-4 py-3 rounded-md bg-bg-base/60 border border-bg-line inline-block">
            <EquationDisplay tex={meta.expression_latex} block />
          </div>
        )}
      </section>

      {/* ============== LEARNER CARDS ============== */}
      <section className="space-y-4">
        <LearnerCard title="What is a phase portrait (return map)?">
          <p>
            Take your chaotic sequence x₀, x₁, x₂, … and plot each pair
            (xₙ, xₙ₊₁) as a dot. What you get is the <strong>return map</strong> —
            and the magic is that those "random-looking" numbers trace out a perfectly
            deterministic curve: the graph of f(x) itself. This is the single clearest
            proof that chaos is NOT randomness — it's deterministic dynamics with
            sensitive dependence on initial conditions. The structure is always there;
            you just have to plot it the right way to see it.
          </p>
        </LearnerCard>
        <LearnerCard title="The butterfly effect — made visible" defaultOpen={false} icon="🦋">
          <p>
            Start two trajectories from almost the same point — say x₀ and x₀ + 10⁻¹².
            For the first few dozen iterations they look identical. Then suddenly they
            diverge and become completely uncorrelated. The rate of divergence is
            exponential, and the slope on a log plot gives you the Lyapunov exponent λ.
            This is the butterfly effect: not a metaphor, but a measurable quantity that
            this panel lets you read off directly.
          </p>
        </LearnerCard>
        {is2D && (
          <LearnerCard title="Strange attractors and fractal structure" defaultOpen={false} icon="🌀">
            <p>
              A strange attractor is the set of points a chaotic trajectory visits
              forever. For the Hénon map, it has a beautiful layered structure: zoom
              in anywhere and the same pattern reappears at smaller scales. This
              self-similarity is the hallmark of a fractal. Click anywhere on the
              attractor below to zoom 4× and see for yourself.
            </p>
          </LearnerCard>
        )}
      </section>

      {/* ============== CONTROLS ============== */}
      <section className="panel p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <MapSelector
            registry={mapsRegistry}
            value={mapId}
            onChange={setMapId}
          />

          {meta?.parameters?.map((p) => (
            <ParameterSlider
              key={p.name}
              spec={p}
              value={params[p.name] ?? p.default}
              onChange={(v) => setParams({ ...params, [p.name]: v })}
            />
          ))}

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
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan"
            />
          </div>
        </div>

        {/* Status line */}
        <div className="mt-3 flex items-center gap-3 text-xs">
          {busy && <span className="caption-mono text-cyan animate-pulse-soft">computing…</span>}
          {error && <span className="caption-mono text-crimson">{error}</span>}
          {orbitData && (
            <span className="caption-mono">
              {orbitData.orbit_full_length?.toLocaleString()} samples · λ = {orbitData.lyapunov?.toFixed(4)}
              {orbitData.lyapunov > 0 ? " (chaotic)" : " (stable)"}
            </span>
          )}
        </div>
      </section>

      {/* ============== MAIN VISUALIZATION ============== */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {is2D ? (
          /* Hénon attractor */
          <div className="panel p-5 lg:col-span-2">
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <div className="text-sm font-semibold text-ink">Strange attractor</div>
                <div className="caption-mono">Hénon map · click to zoom 4× · reveals fractal layers</div>
              </div>
            </div>
            <HenonAttractorChart
              orbitX={orbitData?.orbit_x}
              orbitY={orbitData?.orbit_y}
              width={700}
              height={420}
            />
          </div>
        ) : (
          <>
            {/* Return map */}
            <div className="panel p-5">
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-ink">Return map</div>
                  <div className="caption-mono">(xₙ, xₙ₊₁) — the deterministic curve inside the "noise"</div>
                </div>
              </div>
              <ReturnMapChart orbit={orbitA} domain={domain} size={340} />
            </div>

            {/* Orbit time series */}
            <div className="panel p-5">
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-ink">Orbit time series</div>
                  <div className="caption-mono">xₙ vs n · first 600 samples</div>
                </div>
              </div>
              <OrbitChart orbit={orbitA} domain={domain} showFirst={600} />
            </div>
          </>
        )}
      </section>

      {/* ============== SENSITIVITY DEMO ============== */}
      <section className="panel p-5 space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">Butterfly effect — sensitivity to initial conditions</div>
            <div className="caption-mono">
              orbit A starts at x₀ = {x0.toFixed(5)} · orbit B starts at x₀ + ε where ε = 10^({logEps})
            </div>
          </div>
        </div>

        {/* Epsilon slider */}
        <div className="max-w-md">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-widest text-ink-dim">
              Initial separation ε
            </span>
            <span className="font-mono text-sm text-crimson tabular-nums">
              10<sup>{logEps}</sup> = {epsilon.toExponential(1)}
            </span>
          </div>
          <input
            type="range"
            min={-16} max={-1} step={1}
            value={logEps}
            onChange={(e) => setLogEps(parseInt(e.target.value, 10))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-crimson"
          />
          <div className="flex justify-between mt-0.5">
            <span className="caption-mono text-[10px]">10⁻¹⁶ (tiny)</span>
            <span className="caption-mono text-[10px]">10⁻¹ (large)</span>
          </div>
        </div>

        <SensitivityDemoChart
          orbitA={orbitA}
          orbitB={orbitB}
          lyapunov={orbitData?.lyapunov}
          epsilon={epsilon}
          domain={domain}
        />

        {/* Insight box */}
        {orbitData?.lyapunov > 0 && (
          <div className="rounded-md border-l-4 border-amber/60 bg-amber/[0.04] p-4 text-sm leading-relaxed">
            <div className="text-[10px] uppercase tracking-widest text-amber mb-1">
              Why this matters for CSK
            </div>
            <p className="text-ink/90">
              An eavesdropper who knows the map but is off by just 1 bit in the
              initial condition (ε ≈ 10⁻¹⁶ for 53-bit double precision) will produce
              a completely different sequence after approximately{" "}
              <strong className="text-amber">
                n* = {Math.ceil(-logEps * Math.LN10 / orbitData.lyapunov)} iterations
              </strong>.
              This is the fundamental security guarantee of chaos-based communication:
              exponential divergence turns tiny key errors into total sequence mismatch.
            </p>
          </div>
        )}
      </section>

      {/* ============== CONCEPTS ============== */}
      <section className="space-y-3">
        <div className="section-title px-1">Foundational concepts</div>
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