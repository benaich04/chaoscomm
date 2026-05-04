import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store/useStore.js";
import {
  postMapsOrbit,
  postLyapunovSweep,
  postFeigenbaum,
  getBifurcationExplainers,
} from "../api/client.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { useBifurcationStream } from "../hooks/useBifurcationStream.js";

import BifurcationChart       from "../components/charts/BifurcationChart.jsx";
import LyapunovSpectrumChart  from "../components/charts/LyapunovSpectrumChart.jsx";
import FeigenbaumPanel        from "../components/charts/FeigenbaumPanel.jsx";
import OrbitChart             from "../components/charts/OrbitChart.jsx";
import EquationDisplay        from "../components/math/EquationDisplay.jsx";
import LearnerCard            from "../components/math/LearnerCard.jsx";
import MapSelector            from "../components/controls/MapSelector.jsx";
import BackendToggle          from "../components/controls/BackendToggle.jsx";

/**
 * BifurcationPage — second page in the Chaos Foundations module.
 *
 * Behaviour rules enforced in this rewrite:
 *
 *  1. Every change of map ID triggers a HARD RESET — local state, cached
 *     λ data, Feigenbaum data, locked-r selection, and orbit preview are
 *     all cleared synchronously *before* any new request goes out.  This
 *     eliminates the stale-data leak that used to show old λ curves on
 *     top of new bifurcations.
 *
 *  2. Feigenbaum analysis is only run for maps where it applies in
 *     theory.  The Feigenbaum constant δ is universal *only for smooth
 *     unimodal maps* (Feigenbaum 1978).  For piecewise-linear or
 *     non-cascade maps (tent, PWLCM, Bernoulli, Chebyshev) the panel
 *     would emit garbage; we replace it with an explanatory note.
 *
 *  3. Each side request is tagged with a `(map, pMin, pMax)` key so a
 *     slow response from a previous configuration cannot overwrite the
 *     current state.
 *
 * Maps that DO have a Feigenbaum cascade in this registry:
 *   logistic, sine, cubic     ← smooth unimodal
 *
 * Maps that DO NOT (and we explain why on screen):
 *   tent, pwlcm, bernoulli, chebyshev, hybrid, lss, tlc
 */

// Smooth unimodal maps where Feigenbaum's universality applies.
const MAPS_WITH_CASCADE = new Set(["logistic", "sine", "cubic"]);

const DEFAULT_RANGES = {
  logistic:  [2.5, 4.0],
  tent:      [0.0, 2.0],
  pwlcm:     [0.01, 0.499],
  hybrid:    [0.0, 1.0],
  cubic:     [1.5, 3.0],
  sine:      [0.0, 4.0],
  lss:       [0.0, 4.0],
  tlc:       [0.0, 4.0],
};
const SUPPORTED_MAPS = Object.keys(DEFAULT_RANGES);


export default function BifurcationPage() {
  const { mapsRegistry, mapsRegistryLoading, loadMapsRegistry,
          mapsRegistryError } = useStore();

  // ------------------------------------------------------------------
  // Local state
  // ------------------------------------------------------------------
  const [mapId,    setMapId]    = useState("logistic");
  const [pMin,     setPMin]     = useState(2.5);
  const [pMax,     setPMax]     = useState(4.0);
  const [nParams,  setNParams]  = useState(1500);
  const [lockedR,  setLockedR]  = useState(null);

  const [lyapData,    setLyapData]    = useState(null);
  const [feigData,    setFeigData]    = useState(null);
  const [lyapBusy,    setLyapBusy]    = useState(false);
  const [feigBusy,    setFeigBusy]    = useState(false);
  const [explainers,  setExplainers]  = useState(null);

  const [orbitPreview, setOrbitPreview] = useState(null);
  const [orbitBusy,    setOrbitBusy]    = useState(false);

  const chartRef = useRef(null);
  const lyapKeyRef = useRef("");
  const feigKeyRef = useRef("");

  // ------------------------------------------------------------------
  // Initial loads
  // ------------------------------------------------------------------
  useEffect(() => { loadMapsRegistry(); }, [loadMapsRegistry]);
  useEffect(() => {
    getBifurcationExplainers().then(setExplainers).catch(() => {});
  }, []);

  // ------------------------------------------------------------------
  // HARD RESET on every map change.
  //
  // This effect fires *synchronously* after mapId updates.  It clears
  // every piece of derived state and resets pMin/pMax to the new map's
  // defaults.  The chart canvas is also cleared imperatively.  After
  // this runs, the streaming + side-request effects below will refire
  // with a clean slate.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (DEFAULT_RANGES[mapId]) {
      const [a, b] = DEFAULT_RANGES[mapId];
      setPMin(a);
      setPMax(b);
    }
    setLockedR(null);
    setOrbitPreview(null);
    setLyapData(null);
    setFeigData(null);
    setLyapBusy(false);
    setFeigBusy(false);
    chartRef.current?.clear();
    // Invalidate any in-flight responses by changing both request keys.
    lyapKeyRef.current = `INVALIDATED_${Date.now()}`;
    feigKeyRef.current = `INVALIDATED_${Date.now()}`;
  }, [mapId]);

  // ------------------------------------------------------------------
  // Debounced inputs that drive the streaming spec.
  // ------------------------------------------------------------------
  const dPMin    = useDebouncedValue(pMin, 350);
  const dPMax    = useDebouncedValue(pMax, 350);
  const dNParams = useDebouncedValue(nParams, 350);

  const streamSpec = useMemo(() => {
    if (!SUPPORTED_MAPS.includes(mapId)) return null;
    if (dPMax <= dPMin) return null;
    return {
      map: mapId,
      p_min: dPMin,
      p_max: dPMax,
      n_params: dNParams,
      n_transient: 600,
      n_plot: 200,
      x0: 0.31415,
      chunk_size: 50,
    };
  }, [mapId, dPMin, dPMax, dNParams]);

  // Clear the canvas whenever the streaming spec changes.
  useEffect(() => { chartRef.current?.clear(); }, [streamSpec]);

  const { state: streamState, progress, meta: streamMeta, error: streamError } =
    useBifurcationStream(streamSpec, (chunk) => {
      chartRef.current?.appendChunk(chunk);
    });

  // ------------------------------------------------------------------
  // Side request 1: FAST λ(r) sweep (vectorized, <1 second).
  //
  // Populates the Lyapunov chart immediately.  Tagged with a key to
  // reject stale responses from a previous map.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!streamSpec) return;
    const key = `lyap|${mapId}|${dPMin.toFixed(4)}|${dPMax.toFixed(4)}`;
    lyapKeyRef.current = key;
    setLyapBusy(true);

    postLyapunovSweep({
      map: mapId,
      p_min: dPMin,
      p_max: dPMax,
      n_params: 800,
    })
      .then((data) => {
        if (lyapKeyRef.current !== key) return;
        setLyapData({ param: data.param, lyapunov: data.lyapunov });
      })
      .catch(() => {})
      .finally(() => {
        if (lyapKeyRef.current === key) setLyapBusy(false);
      });
  }, [streamSpec, mapId, dPMin, dPMax]);

  // ------------------------------------------------------------------
  // Side request 2: SLOW Feigenbaum analysis (~15-30s, sequential).
  //
  // Only runs for maps where Feigenbaum's universality applies.
  // Uses a 90s timeout in the API client.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!streamSpec || !MAPS_WITH_CASCADE.has(mapId)) {
      setFeigData(null);
      setFeigBusy(false);
      return;
    }
    const key = `feig|${mapId}|${dPMin.toFixed(4)}|${dPMax.toFixed(4)}`;
    feigKeyRef.current = key;
    setFeigBusy(true);

    postFeigenbaum({
      map: mapId,
      p_min: dPMin,
      p_max: dPMax,
      n_params: 600,
    })
      .then((data) => {
        if (feigKeyRef.current !== key) return;
        setFeigData(data);
      })
      .catch(() => {})
      .finally(() => {
        if (feigKeyRef.current === key) setFeigBusy(false);
      });
  }, [streamSpec, mapId, dPMin, dPMax]);

  // ------------------------------------------------------------------
  // Click handler — fetch the orbit at the clicked parameter.
  // ------------------------------------------------------------------
  const handlePickPoint = (r) => {
    if (!mapsRegistry?.maps?.[mapId]) return;
    setLockedR(r);
    setOrbitBusy(true);
    setOrbitPreview(null);

    const meta = mapsRegistry.maps[mapId];
    const paramName = meta.parameters[0]?.name;
    if (!paramName) return;

    postMapsOrbit({
      map: mapId,
      parameters: { [paramName]: r },
      initial_state: [0.31415],
      n_samples: 1000,
    })
      .then((data) => { setOrbitPreview(data); setOrbitBusy(false); })
      .catch(() => { setOrbitBusy(false); });
  };

  // ------------------------------------------------------------------
  // Loading / error gates.
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // Derived values for rendering
  // ------------------------------------------------------------------
  const meta = mapsRegistry.maps[mapId];
  const tier = meta?.tier;
  const tierColor =
    tier === "tier1_textbook"   ? "bg-cyan/15 text-cyan border-cyan/30" :
    tier === "tier2_research"   ? "bg-amber/15 text-amber border-amber/30" :
    tier === "tier2_engineered" ? "bg-phosphor/15 text-phosphor border-phosphor/30" :
    "bg-bg-line text-ink-muted";
  const tierLabel =
    tier === "tier1_textbook"   ? "Textbook" :
    tier === "tier2_research"   ? "Research" :
    tier === "tier2_engineered" ? "Engineered (Zhou et al. 2014)" : tier;

  const showFeigenbaum = MAPS_WITH_CASCADE.has(mapId);
  const aInfinity =
    showFeigenbaum && feigData
      ? (mapId === "logistic" ? feigData.a_infinity_theoretical_logistic : feigData.a_infinity_estimate)
      : null;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">

      {/* ============== HERO ============== */}
      <section className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">
          MODULE · BIFURCATION & FEIGENBAUM
        </div>
        <div className="flex items-baseline gap-3 mb-1">
          <span className={`pill border ${tierColor}`}>{tierLabel}</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          Bifurcation diagram & period-doubling cascade
        </h1>
        <p className="text-ink-muted text-sm mb-5">
          {meta?.name} — sweep the parameter, watch the orbit double, find where chaos begins.
        </p>
        {meta?.expression_latex && (
          <div className="mt-2 px-4 py-3 rounded-md bg-bg-base/60 border border-bg-line inline-block">
            <EquationDisplay tex={meta.expression_latex} block className="text-ink" />
          </div>
        )}
      </section>

      {/* ============== LEARNER STACK ============== */}
      {explainers && (
        <section className="space-y-4">
          <LearnerCard title="What is a bifurcation diagram?">
            <p>{explainers.bifurcation_diagram}</p>
          </LearnerCard>
          <LearnerCard title="The Feigenbaum constant — and why it's universal" defaultOpen={false} icon="δ">
            <p>{explainers.feigenbaum_constant}</p>
          </LearnerCard>
        </section>
      )}

      {/* ============== CONTROLS STRIP ============== */}
      <section className="panel p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
          <div className="lg:col-span-2">
            <MapSelector
              registry={{
                ...mapsRegistry,
                maps: Object.fromEntries(
                  Object.entries(mapsRegistry.maps).filter(
                    ([k, v]) => SUPPORTED_MAPS.includes(k) && v.dimension === 1
                  )
                ),
              }}
              value={mapId}
              onChange={setMapId}
            />
          </div>
          <ParamRangeInput
            label="p min"
            value={pMin}
            min={DEFAULT_RANGES[mapId]?.[0] ?? 0}
            max={pMax - 0.01}
            step={0.001}
            onChange={setPMin}
          />
          <ParamRangeInput
            label="p max"
            value={pMax}
            min={pMin + 0.01}
            max={DEFAULT_RANGES[mapId]?.[1] ?? 4}
            step={0.001}
            onChange={setPMax}
          />
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-ink-dim">
                Resolution
              </span>
              <span className="font-mono text-sm text-amber">{nParams}</span>
            </div>
            <input
              type="range"
              min={500} max={2500} step={100}
              value={nParams}
              onChange={(e) => setNParams(parseInt(e.target.value, 10))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs">
            {streamState === "streaming" && (
              <>
                <span className="caption-mono text-cyan animate-pulse-soft">
                  Streaming · {Math.round(progress * 100)}%
                </span>
                <div className="w-32 h-1 bg-bg-line rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan transition-all"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </>
            )}
            {streamState === "complete" && (
              <span className="caption-mono text-phosphor">Complete</span>
            )}
            {streamState === "error" && (
              <span className="caption-mono text-crimson">Error: {streamError}</span>
            )}
            {streamMeta && (
              <span className="caption-mono">
                {streamMeta.n_params} parameters · {streamMeta.n_plot} samples each
              </span>
            )}
          </div>
          <BackendToggle />
        </div>
      </section>

      {/* ============== BIFURCATION CHART ============== */}
      <section className="panel p-5">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-ink">Bifurcation diagram</div>
            <div className="caption-mono">click anywhere to lock in a parameter</div>
          </div>
        </div>
        <BifurcationChart
          ref={chartRef}
          pMin={dPMin}
          pMax={dPMax}
          yMin={meta?.domain[0] ?? 0}
          yMax={meta?.domain[1] ?? 1}
          height={380}
          aInfinity={aInfinity}
          lockedR={lockedR}
          onClickPoint={handlePickPoint}
        />
      </section>

      {/* ============== LYAPUNOV SPECTRUM ============== */}
      <section className="panel p-5">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-ink">Lyapunov spectrum λ(r)</div>
            <div className="caption-mono">
              periodic windows align with λ &lt; 0 dips above
            </div>
          </div>
          {lyapBusy && <span className="caption-mono text-cyan animate-pulse-soft">computing…</span>}
        </div>
        <LyapunovSpectrumChart
          param={lyapData?.param}
          lyapunov={lyapData?.lyapunov}
          pMin={dPMin}
          pMax={dPMax}
          lockedR={lockedR}
          height={210}
        />
      </section>

      {/* ============== FEIGENBAUM (or notice) + ORBIT PREVIEW ============== */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {showFeigenbaum
          ? <FeigenbaumPanel data={feigData} mapId={mapId} busy={feigBusy} />
          : <FeigenbaumNotApplicableNotice mapId={mapId} mapName={meta?.name} />
        }

        <div className="panel p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="section-title">Locked-r orbit preview</div>
              <div className="caption-mono mt-0.5">
                {lockedR != null ? `r = ${lockedR.toFixed(5)}` : "click the diagram to pick a parameter"}
              </div>
            </div>
            {orbitPreview?.lyapunov != null && (
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-widest text-ink-dim">λ at this r</div>
                <div className={[
                  "text-lg font-semibold tabular-nums",
                  orbitPreview.lyapunov > 0 ? "text-phosphor" : "text-amber",
                ].join(" ")}>
                  {orbitPreview.lyapunov.toFixed(4)}
                </div>
              </div>
            )}
          </div>
          {orbitBusy && (
            <div className="text-xs text-cyan animate-pulse-soft">computing orbit…</div>
          )}
          {orbitPreview && (
            <OrbitChart
              orbit={orbitPreview.orbit}
              domain={meta?.domain ?? [0, 1]}
              showFirst={400}
            />
          )}
          {!orbitPreview && !orbitBusy && (
            <div className="h-60 flex items-center justify-center text-xs text-ink-dim">
              No selection yet — click any point on the bifurcation diagram above
            </div>
          )}
        </div>
      </section>

      {/* ============== CONCEPT CARDS ============== */}
      {explainers && (
        <section className="space-y-3">
          <div className="section-title px-1">Foundational concepts</div>
          <LearnerCard title="Period-doubling — the road to chaos" defaultOpen={false} icon="∝">
            <p>{explainers.period_doubling}</p>
          </LearnerCard>
          <LearnerCard title="The accumulation point a∞" defaultOpen={false} icon="🚪">
            <p>{explainers.accumulation_point}</p>
          </LearnerCard>
          <LearnerCard title="Reading the Lyapunov spectrum" defaultOpen={false} icon="λ">
            <p>{explainers.lyapunov_spectrum}</p>
          </LearnerCard>
        </section>
      )}
    </div>
  );
}


/* ============== Small helpers ============== */

function ParamRangeInput({ label, value, min, max, step, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-widest text-ink-dim">{label}</span>
        <span className="font-mono text-sm text-amber">{Number(value).toFixed(3)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber"
      />
    </div>
  );
}


/**
 * FeigenbaumNotApplicableNotice — replaces the panel for maps where the
 * universal δ ≈ 4.6692 does not apply.  Each map gets a tailored note so
 * the student understands *why* this column is empty rather than seeing
 * fake numbers.
 */
function FeigenbaumNotApplicableNotice({ mapId, mapName }) {
  const reasons = {
    tent: (
      <>
        The tent map is <strong>piecewise linear</strong> and has a sharp peak —
        it does not undergo a smooth period-doubling cascade.  Instead the system
        transitions from a stable fixed point at μ = 1 directly into chaos.
        Feigenbaum's universality theorem applies only to maps with a smooth
        unimodal maximum (logistic, sine, cubic).
      </>
    ),
    pwlcm: (
      <>
        PWLCM is <strong>piecewise linear by construction</strong> — its derivative
        jumps between values, with no smooth maximum.  There is no period-doubling
        cascade to extract a Feigenbaum δ from.
      </>
    ),
    bernoulli: (
      <>
        The Bernoulli shift has no parameter and no cascade — the map x ↦ 2x mod 1
        is fully chaotic by construction with λ = ln 2 exactly.  Bifurcation
        analysis does not apply.
      </>
    ),
    chebyshev: (
      <>
        The Chebyshev map's parameter <em>n</em> is integer-valued; varying it
        produces discrete jumps in dynamics, not a continuous bifurcation cascade.
        Each integer n ≥ 2 gives a fully chaotic map with λ = ln n exactly.
      </>
    ),
    hybrid: (
      <>
        The hybrid map blends a smooth (logistic) component with a piecewise tent
        component, so its bifurcation structure depends sensitively on the blending
        parameter and does not exhibit the clean Feigenbaum cascade.
      </>
    ),
    lss: (
      <>
        The LSS map (Zhou et al. 2014) is engineered to be chaotic across the
        entire r range — there is no period-doubling cascade leading into chaos,
        which is precisely the property that makes it useful for CSK.
      </>
    ),
    tlc: (
      <>
        The TLC map (Zhou et al. 2014), like LSS, is engineered to skip the
        period-doubling cascade entirely.  It enters chaos directly — making the
        Feigenbaum framework inapplicable here.
      </>
    ),
  };

  return (
    <div className="panel p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="section-title">Feigenbaum analysis</div>
          <div className="caption-mono mt-0.5">universality of δ ≈ 4.6692</div>
        </div>
        <span className="pill bg-bg-base/40 text-ink-muted border border-bg-line text-[10px]">
          Not applicable
        </span>
      </div>
      <div className="rounded-md border-l-4 border-amber/50 bg-amber/[0.04] p-4 text-sm leading-relaxed text-ink/90">
        <div className="text-[10px] uppercase tracking-widest text-amber mb-1.5">
          Why this column is empty for the {mapName ?? mapId}
        </div>
        {reasons[mapId] ?? (
          <p>The Feigenbaum constant δ is universal only for smooth unimodal maps.
          The current map does not fall in that family, so its bifurcation
          structure is qualitatively different.</p>
        )}
      </div>
      <div className="text-[11px] text-ink-dim leading-relaxed pt-2 border-t border-bg-line">
        Try switching to <strong className="text-cyan">logistic</strong>,{" "}
        <strong className="text-cyan">sine</strong>, or{" "}
        <strong className="text-cyan">cubic</strong> to see the full Feigenbaum
        analysis — the same δ ≈ 4.6692 should appear for all three.
      </div>
    </div>
  );
}