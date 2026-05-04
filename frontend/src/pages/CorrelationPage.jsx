import { useEffect, useState, useRef } from "react";
import { useStore } from "../store/useStore.js";
import { postMapsOrbit } from "../api/client.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

import MapSelector     from "../components/controls/MapSelector.jsx";
import ParameterSlider from "../components/controls/ParameterSlider.jsx";
import EquationDisplay from "../components/math/EquationDisplay.jsx";
import LearnerCard     from "../components/math/LearnerCard.jsx";

const API = "http://localhost:8000";

/**
 * CorrelationPage — the mathematical foundation of why chaos works for CSK.
 *
 * Layout:
 *   1. Hero + equations
 *   2. Learner cards
 *   3. Controls: map A (bit 0), map B (bit 1), sequence length, max lag
 *   4. Autocorrelation of A + B side-by-side with PSL / merit factor
 *   5. Cross-correlation A×B with max value
 *   6. Merit factor sweep (F vs parameter r)
 *   7. Ambiguity function heatmap
 *   8. Deep-dive concept cards
 */

function defaultParamsFor(meta) {
  if (!meta?.parameters) return {};
  return Object.fromEntries(meta.parameters.map(p => [p.name, p.default]));
}

export default function CorrelationPage() {
  const { mapsRegistry, mapsRegistryLoading, loadMapsRegistry, mapsRegistryError } = useStore();

  // Controls
  const [mapId, setMapId]       = useState("logistic");
  const [paramsA, setParamsA]   = useState({ r: 3.9 });
  const [paramsB, setParamsB]   = useState({ r: 3.6 });
  const [seqLen, setSeqLen]     = useState(128);
  const [maxLag, setMaxLag]     = useState(64);

  // Data
  const [fullData, setFullData]     = useState(null);
  const [sweepData, setSweepData]   = useState(null);
  const [ambData, setAmbData]       = useState(null);
  const [explainers, setExplainers] = useState(null);
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState(null);

  useEffect(() => { loadMapsRegistry(); }, [loadMapsRegistry]);

  useEffect(() => {
    fetch(`${API}/api/correlation/explainers`)
      .then(r => r.json()).then(setExplainers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!mapsRegistry) return;
    const meta = mapsRegistry.maps[mapId];
    if (!meta) return;
    setParamsA(defaultParamsFor(meta));
    setParamsB(defaultParamsFor(meta));
    setFullData(null); setSweepData(null); setAmbData(null);
  }, [mapId, mapsRegistry]);

  const dParamsA = useDebouncedValue(paramsA, 300);
  const dParamsB = useDebouncedValue(paramsB, 300);
  const dSeqLen  = useDebouncedValue(seqLen, 300);
  const dMaxLag  = useDebouncedValue(maxLag, 300);

  useEffect(() => {
    if (!mapsRegistry) return;
    const meta = mapsRegistry.maps[mapId];
    if (!meta || meta.dimension !== 1) return;

    setBusy(true); setError(null);

    const paramNameA = meta.parameters[0]?.name ?? "r";
    const valA = dParamsA[paramNameA] ?? meta.parameters[0]?.default;
    const valB = dParamsB[paramNameA] ?? meta.parameters[0]?.default;

    // Generate two sequences via orbit
    const orbA = postMapsOrbit({
      map: mapId, parameters: dParamsA,
      initial_state: [meta.default_x0 ?? 0.31415],
      n_samples: dSeqLen + 50,
    });
    const orbB = postMapsOrbit({
      map: mapId, parameters: dParamsB,
      initial_state: [0.7],
      n_samples: dSeqLen + 50,
    });

    Promise.all([orbA, orbB])
      .then(([a, b]) => {
        const seqA = a.orbit.slice(50, 50 + dSeqLen);
        const seqB = b.orbit.slice(50, 50 + dSeqLen);

        // Full analysis + merit sweep + ambiguity (parallel)
        const fullP = fetch(`${API}/api/correlation/full`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seq_a: seqA, seq_b: seqB, max_lag: dMaxLag }),
        }).then(r => r.json());

        const meta0 = mapsRegistry.maps[mapId];
        const pMin = meta0.parameters[0]?.min ?? 2.5;
        const pMax = meta0.parameters[0]?.max ?? 4.0;

        const sweepP = fetch(`${API}/api/correlation/merit-sweep`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            map_name: mapId, param_min: pMin, param_max: pMax,
            n_params: 50, seq_length: Math.min(dSeqLen, 128),
          }),
        }).then(r => r.json());

        const ambP = fetch(`${API}/api/correlation/ambiguity`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sequence: seqA.slice(0, 64),
            max_delay: 16, n_doppler: 24,
          }),
        }).then(r => r.json());

        return Promise.all([fullP, sweepP, ambP]);
      })
      .then(([full, sweep, amb]) => {
        setFullData(full);
        setSweepData(sweep);
        setAmbData(amb);
        setBusy(false);
      })
      .catch(e => { setError(e.message); setBusy(false); });
  }, [mapId, dParamsA, dParamsB, dSeqLen, dMaxLag, mapsRegistry]);

  if (mapsRegistryError || mapsRegistryLoading || !mapsRegistry) {
    return (
      <div className="px-8 py-8 max-w-6xl mx-auto">
        <div className="text-sm text-ink-muted animate-pulse-soft">
          {mapsRegistryError || "Loading…"}
        </div>
      </div>
    );
  }

  const meta = mapsRegistry.maps[mapId];
  const paramSpec = meta?.parameters?.[0];
  const summary = fullData?.summary;

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">

      {/* ============== HERO ============== */}
      <section className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">
          MODULE · CORRELATION ANALYSIS
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          Correlation properties of chaotic sequences
        </h1>
        <p className="text-ink-muted text-sm mb-4">
          The mathematical reason chaos works for spread-spectrum communication — sharp
          autocorrelation peaks, low cross-correlation between different sequences.
        </p>
        <div className="flex gap-4 flex-wrap">
          <div className="px-4 py-3 rounded-md bg-bg-base/60 border border-bg-line">
            <EquationDisplay tex={"R_{xx}[k] = \\sum_n x[n] \\cdot x[n+k]"} block />
          </div>
          <div className="px-4 py-3 rounded-md bg-bg-base/60 border border-bg-line">
            <EquationDisplay tex={"F = \\frac{R[0]^2}{2\\sum_{k\\neq 0} R[k]^2}"} block />
          </div>
        </div>
      </section>

      {/* ============== LEARNER CARDS ============== */}
      {explainers && (
        <section className="space-y-4">
          <LearnerCard title="What is autocorrelation and why does it matter for CSK?">
            <p>{explainers.autocorrelation}</p>
          </LearnerCard>
          <LearnerCard title="Chaotic sequences vs PN codes — which is better?" defaultOpen={false} icon="⚡">
            <p>{explainers.chaos_vs_pn_sequences}</p>
          </LearnerCard>
        </section>
      )}

      {/* ============== CONTROLS ============== */}
      <section className="panel p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
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

          {/* Sequence A parameter */}
          {paramSpec && (
            <ParameterSlider
              spec={{ ...paramSpec, label: `Seq A — ${paramSpec.name}` }}
              value={paramsA[paramSpec.name] ?? paramSpec.default}
              onChange={v => setParamsA({ ...paramsA, [paramSpec.name]: v })}
            />
          )}

          {/* Sequence B parameter */}
          {paramSpec && (
            <ParameterSlider
              spec={{ ...paramSpec, label: `Seq B — ${paramSpec.name}` }}
              value={paramsB[paramSpec.name] ?? paramSpec.default}
              onChange={v => setParamsB({ ...paramsB, [paramSpec.name]: v })}
            />
          )}

          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-widest text-ink-dim">Sequence length</span>
                <span className="font-mono text-sm text-amber">{seqLen}</span>
              </div>
              <input type="range" min={32} max={512} step={32}
                value={seqLen} onChange={e => setSeqLen(+e.target.value)}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-widest text-ink-dim">Max lag</span>
                <span className="font-mono text-sm text-amber">{maxLag}</span>
              </div>
              <input type="range" min={16} max={128} step={8}
                value={maxLag} onChange={e => setMaxLag(+e.target.value)}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan"
              />
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3 text-xs">
          {busy && <span className="caption-mono text-cyan animate-pulse-soft">computing…</span>}
          {error && <span className="caption-mono text-crimson">{error}</span>}
          {summary && (
            <span className="caption-mono">
              MF_A = {summary.merit_factor_a.toFixed(3)} ·
              MF_B = {summary.merit_factor_b.toFixed(3)} ·
              PSL_A = {(summary.psl_a * 100).toFixed(1)}% ·
              max |R_AB| = {(summary.max_xcorr_normalized * 100).toFixed(1)}%
            </span>
          )}
        </div>
      </section>

      {/* ============== AUTOCORRELATION SIDE BY SIDE ============== */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CorrChart
          title="Autocorrelation — Sequence A"
          subtitle={`PSL = ${summary?.psl_a ? (summary.psl_a * 100).toFixed(1) : "—"}% · Merit Factor = ${summary?.merit_factor_a?.toFixed(3) ?? "—"}`}
          lags={fullData?.autocorr_a?.lags}
          values={fullData?.autocorr_a?.R_normalized}
          color="#22d3ee"
        />
        <CorrChart
          title="Autocorrelation — Sequence B"
          subtitle={`PSL = ${summary?.psl_b ? (summary.psl_b * 100).toFixed(1) : "—"}% · Merit Factor = ${summary?.merit_factor_b?.toFixed(3) ?? "—"}`}
          lags={fullData?.autocorr_b?.lags}
          values={fullData?.autocorr_b?.R_normalized}
          color="#fbbf24"
        />
      </section>

      {/* ============== CROSS-CORRELATION ============== */}
      <section className="panel p-5">
        <div className="mb-3">
          <div className="text-sm font-semibold text-ink">Cross-correlation A × B</div>
          <div className="caption-mono">
            max |R_AB| = {summary ? (summary.max_xcorr_normalized * 100).toFixed(1) : "—"}% of mainlobe —
            lower is better for CSK bit discrimination
          </div>
        </div>
        <CorrChart
          lags={fullData?.cross_corr?.lags}
          values={fullData?.cross_corr?.R_xy_normalized}
          color="#ef4444"
          showZeroLine
        />
        {summary && (
          <div className={[
            "mt-3 text-sm rounded-md border-l-4 p-3",
            summary.max_xcorr_normalized < 0.3
              ? "border-phosphor/60 bg-phosphor/[0.04] text-phosphor"
              : summary.max_xcorr_normalized < 0.6
                ? "border-amber/60 bg-amber/[0.04] text-amber"
                : "border-crimson/60 bg-crimson/[0.04] text-crimson",
          ].join(" ")}>
            {summary.max_xcorr_normalized < 0.3
              ? "✓ Excellent — low cross-correlation, sequences are well-separated"
              : summary.max_xcorr_normalized < 0.6
                ? "△ Moderate — some bit confusion at low SNR"
                : "✗ High cross-correlation — may cause bit errors. Try different parameters."}
          </div>
        )}
      </section>

      {/* ============== MERIT FACTOR SWEEP ============== */}
      {sweepData && (
        <section className="panel p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink">Merit factor vs parameter</div>
            <div className="caption-mono">
              sweep across all parameter values — pick r where Merit Factor is highest
            </div>
          </div>
          <MeritSweepChart data={sweepData} />
        </section>
      )}

      {/* ============== AMBIGUITY FUNCTION ============== */}
      {ambData && (
        <section className="panel p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink">Ambiguity function χ(τ, ν)</div>
            <div className="caption-mono">
              delay × Doppler — thumbtack shape = ideal radar waveform
            </div>
          </div>
          <AmbiguityHeatmap data={ambData} />
        </section>
      )}

      {/* ============== METRICS ============== */}
      {summary && (
        <section className="panel p-5">
          <div className="section-title mb-3">Correlation quality summary</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Merit Factor A" value={summary.merit_factor_a.toFixed(3)} good={summary.merit_factor_a > 1} />
            <Stat label="Merit Factor B" value={summary.merit_factor_b.toFixed(3)} good={summary.merit_factor_b > 1} />
            <Stat label="PSL A" value={`${(summary.psl_a * 100).toFixed(1)}%`} good={summary.psl_a < 0.2} />
            <Stat label="PSL B" value={`${(summary.psl_b * 100).toFixed(1)}%`} good={summary.psl_b < 0.2} />
            <Stat label="Max Cross-corr" value={`${(summary.max_xcorr_normalized * 100).toFixed(1)}%`} good={summary.max_xcorr_normalized < 0.3} />
            <Stat label="Sequence length" value={summary.sequence_length} />
          </div>
        </section>
      )}

      {/* ============== CONCEPT CARDS ============== */}
      {explainers && (
        <section className="space-y-3">
          <div className="section-title px-1">Deep dive</div>
          <LearnerCard title="Cross-correlation and CSK bit discrimination" defaultOpen={false} icon="⊗">
            <p>{explainers.cross_correlation}</p>
          </LearnerCard>
          <LearnerCard title="Merit Factor — one number to rule them all" defaultOpen={false} icon="F">
            <p>{explainers.merit_factor}</p>
          </LearnerCard>
          <LearnerCard title="Peak sidelobe level" defaultOpen={false} icon="📉">
            <p>{explainers.peak_sidelobe}</p>
          </LearnerCard>
          <LearnerCard title="Ambiguity function and radar performance" defaultOpen={false} icon="📡">
            <p>{explainers.ambiguity_function}</p>
          </LearnerCard>
        </section>
      )}
    </div>
  );
}


// ============== Reusable sub-components ==============

function CorrChart({ title, subtitle, lags, values, color = "#22d3ee", showZeroLine = false }) {
  if (!lags || !values || lags.length === 0) {
    return (
      <div className="panel p-5">
        {title && <div className="text-sm font-semibold text-ink mb-1">{title}</div>}
        <div className="h-48 flex items-center justify-center text-xs text-ink-dim">
          No data yet
        </div>
      </div>
    );
  }

  const step = Math.max(1, Math.floor(lags.length / 300));
  const data = [];
  for (let i = 0; i < lags.length; i += step) {
    data.push({ lag: lags[i], value: values[i] });
  }

  return (
    <div className="panel p-5">
      {title && <div className="text-sm font-semibold text-ink mb-0.5">{title}</div>}
      {subtitle && <div className="caption-mono mb-3">{subtitle}</div>}
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
          <XAxis
            dataKey="lag" type="number"
            stroke="#94a3b8" tick={{ fontSize: 10, fill: "#94a3b8" }}
            label={{ value: "lag k", position: "insideBottomRight", offset: -2, fill: "#94a3b8", fontSize: 10 }}
          />
          <YAxis
            domain={[-1.1, 1.1]}
            stroke="#94a3b8" tick={{ fontSize: 10, fill: "#94a3b8" }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#141b2d", border: "1px solid #2a3454", borderRadius: "6px", fontSize: "12px" }}
            labelFormatter={v => `lag = ${v}`}
            formatter={v => [Number(v).toFixed(4), "R"]}
          />
          <ReferenceLine y={0} stroke="#64748b" strokeWidth={0.5} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}


function MeritSweepChart({ data }) {
  if (!data?.param_values?.length) return null;

  const chartData = data.param_values.map((p, i) => ({
    param: p,
    merit_factor: data.merit_factors[i],
    psl: data.psls[i],
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
        <XAxis
          dataKey="param" type="number"
          stroke="#94a3b8" tick={{ fontSize: 10, fill: "#94a3b8" }}
          tickFormatter={v => Number(v).toFixed(2)}
          label={{ value: "parameter", position: "insideBottomRight", offset: -2, fill: "#94a3b8", fontSize: 10 }}
        />
        <YAxis stroke="#94a3b8" tick={{ fontSize: 10, fill: "#94a3b8" }} />
        <Tooltip
          contentStyle={{ backgroundColor: "#141b2d", border: "1px solid #2a3454", borderRadius: "6px", fontSize: "12px" }}
          labelFormatter={v => `r = ${Number(v).toFixed(3)}`}
          formatter={(v, name) => [Number(v).toFixed(3), name === "merit_factor" ? "Merit Factor F" : "PSL"]}
        />
        <Line type="monotone" dataKey="merit_factor" name="merit_factor" stroke="#fbbf24" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="psl" name="psl" stroke="#ef4444" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}


function AmbiguityHeatmap({ data }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv || !data?.chi?.length) return;
    const rows = data.chi.length;
    const cols = data.chi[0]?.length || 0;
    if (cols === 0) return;
    const W = cnv.parentElement?.clientWidth || 600;
    const H = 200;
    const dpr = window.devicePixelRatio || 1;
    cnv.width = W * dpr; cnv.height = H * dpr;
    cnv.style.width = `${W}px`; cnv.style.height = `${H}px`;
    const ctx = cnv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cellW = W / cols;
    const cellH = H / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = Math.min(1, Math.max(0, data.chi[r][c]));
        const b = Math.round(v * 255);
        const g = Math.round(v * 200);
        ctx.fillStyle = `rgb(0,${g},${b})`;
        ctx.fillRect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5);
      }
    }
  }, [data]);

  if (!data?.chi?.length) return null;

  return (
    <div className="w-full">
      <canvas ref={canvasRef} className="rounded-md" style={{ width: "100%", height: 200, display: "block" }} />
      <div className="flex justify-between mt-1 caption-mono text-[10px]">
        <span>delay: {data.delays?.[0]} chips</span>
        <span>↕ delay · ↔ Doppler</span>
        <span>delay: +{data.delays?.[data.delays.length - 1]} chips</span>
      </div>
    </div>
  );
}


function Stat({ label, value, good }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-ink-dim">{label}</div>
      <div className={`font-mono text-sm ${good === true ? "text-phosphor" : good === false ? "text-crimson" : "text-ink"}`}>
        {value ?? "—"}
      </div>
    </div>
  );
}