import { useEffect, useState, useRef } from "react";
import { useStore } from "../store/useStore.js";
import { postMapsOrbit } from "../api/client.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import MapSelector     from "../components/controls/MapSelector.jsx";
import ParameterSlider from "../components/controls/ParameterSlider.jsx";
import EquationDisplay from "../components/math/EquationDisplay.jsx";
import LearnerCard     from "../components/math/LearnerCard.jsx";

const API = "http://localhost:8000";

const COMPARE_CONFIGS = [
  { name: "Logistic r=3.9", map_name: "logistic", parameter: 3.9 },
  { name: "Logistic r=4.0", map_name: "logistic", parameter: 4.0 },
  { name: "Tent μ=2.0",     map_name: "tent",     parameter: 2.0 },
  { name: "PWLCM p=0.3",    map_name: "pwlcm",    parameter: 0.3 },
];

const LINE_COLORS = ["#22d3ee", "#fbbf24", "#10b981", "#a78bfa"];

function defaultParamsFor(meta) {
  if (!meta?.parameters) return {};
  return Object.fromEntries(meta.parameters.map(p => [p.name, p.default]));
}

export default function SpectrumPage() {
  const { mapsRegistry, mapsRegistryLoading, loadMapsRegistry, mapsRegistryError } = useStore();

  const [mapId, setMapId]   = useState("logistic");
  const [params, setParams] = useState({ r: 3.9 });
  const [seqLen, setSeqLen] = useState(512);

  const [specData, setSpecData]       = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [explainers, setExplainers]   = useState(null);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState(null);

  useEffect(() => { loadMapsRegistry(); }, [loadMapsRegistry]);
  useEffect(() => {
    fetch(`${API}/api/spectrum/explainers`).then(r => r.json()).then(setExplainers).catch(() => {});
    // Preload comparison
    fetch(`${API}/api/spectrum/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ map_configs: COMPARE_CONFIGS, seq_length: 512 }),
    }).then(r => r.json()).then(setCompareData).catch(() => {});
  }, []);

  useEffect(() => {
    if (!mapsRegistry) return;
    const meta = mapsRegistry.maps[mapId];
    if (meta) setParams(defaultParamsFor(meta));
  }, [mapId, mapsRegistry]);

  const dParams = useDebouncedValue(params, 300);
  const dSeqLen = useDebouncedValue(seqLen, 300);

  useEffect(() => {
    if (!mapsRegistry) return;
    const meta = mapsRegistry.maps[mapId];
    if (!meta || meta.dimension !== 1) return;
    setBusy(true); setError(null);

    postMapsOrbit({
      map: mapId, parameters: dParams,
      initial_state: [meta.default_x0 ?? 0.31415],
      n_samples: dSeqLen + 200,
    })
      .then(o => {
        const signal = o.orbit.slice(200, 200 + dSeqLen);
        return fetch(`${API}/api/spectrum/compute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signal, fs: 1.0 }),
        }).then(r => r.json());
      })
      .then(s => { setSpecData(s); setBusy(false); })
      .catch(e => { setError(e.message); setBusy(false); });
  }, [mapId, dParams, dSeqLen, mapsRegistry]);

  if (mapsRegistryLoading || !mapsRegistry) {
    return <div className="px-8 py-8 text-sm text-ink-muted animate-pulse-soft">Loading…</div>;
  }

  const meta = mapsRegistry.maps[mapId];

  // Build Recharts data arrays
  const specChartData = specData
    ? specData.freq.map((f, i) => ({ freq: f, psd: specData.psd_db[i] }))
    : [];

  const compareChartData = compareData?.results?.length
    ? compareData.results[0].freq.map((f, i) => {
        const row = { freq: f };
        compareData.results.forEach((r, ri) => { row[`s${ri}`] = r.psd_db[i]; });
        return row;
      })
    : [];

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">

      {/* HERO */}
      <section className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">MODULE · SPECTRAL ANALYSIS</div>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Spectral analysis — LPI characterization</h1>
        <p className="text-ink-muted text-sm mb-4">
          How flat is the chaotic spectrum? A flat PSD looks like noise to an adversary.
        </p>
        <div className="flex gap-4 flex-wrap">
          <div className="px-4 py-3 rounded-md bg-bg-base/60 border border-bg-line">
            <EquationDisplay tex={"\\xi = \\frac{\\exp(\\frac{1}{N}\\sum \\ln S_k)}{\\frac{1}{N}\\sum S_k}"} block />
          </div>
          <div className="px-4 py-3 rounded-md bg-bg-base/60 border border-bg-line">
            <EquationDisplay tex={"H = -\\sum_k p_k \\log_2 p_k"} block />
          </div>
        </div>
      </section>

      {/* LEARNER CARDS */}
      {explainers && (
        <section className="space-y-3">
          <LearnerCard title="What is the PSD and how is it computed?">
            <p>{explainers.psd}</p>
          </LearnerCard>
          <LearnerCard title="LPI — why a flat spectrum is a security feature" defaultOpen={false} icon="🛡">
            <p>{explainers.lpi}</p>
          </LearnerCard>
        </section>
      )}

      {/* CONTROLS */}
      <section className="panel p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          <MapSelector
            registry={{
              ...mapsRegistry,
              maps: Object.fromEntries(
                Object.entries(mapsRegistry.maps).filter(([, v]) => v.dimension === 1)
              ),
            }}
            value={mapId} onChange={setMapId}
          />
          {meta?.parameters?.map(p => (
            <ParameterSlider key={p.name} spec={p}
              value={params[p.name] ?? p.default}
              onChange={v => setParams({ ...params, [p.name]: v })}
            />
          ))}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-ink-dim">Signal length</span>
              <span className="font-mono text-sm text-amber">{seqLen}</span>
            </div>
            <input type="range" min={128} max={2048} step={128} value={seqLen}
              onChange={e => setSeqLen(+e.target.value)}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber"
            />
          </div>
        </div>
        <div className="mt-3 text-xs">
          {busy && <span className="caption-mono text-cyan animate-pulse-soft">computing…</span>}
          {error && <span className="caption-mono text-crimson">{error}</span>}
          {specData && (
            <span className="caption-mono">
              Spectral flatness: {(specData.spectral_flatness * 100).toFixed(1)}% ·
              Entropy: {(specData.spectral_entropy_normalized * 100).toFixed(1)}% ·
              PAR: {specData.peak_to_average_db.toFixed(1)} dB ·
              BW₃dB: {specData.bandwidth_3db.toFixed(3)}
            </span>
          )}
        </div>
      </section>

      {/* PSD CHART */}
      <section className="panel p-5">
        <div className="mb-3">
          <div className="text-sm font-semibold text-ink">Power spectral density (Welch)</div>
          <div className="caption-mono">flat spectrum = noise-like = LPI advantage</div>
        </div>
        {specChartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={specChartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
              <XAxis dataKey="freq" type="number"
                stroke="#94a3b8" tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickFormatter={v => Number(v).toFixed(2)}
                label={{ value: "Normalized frequency", position: "insideBottomRight", offset: -4, fill: "#94a3b8", fontSize: 10 }}
              />
              <YAxis stroke="#94a3b8" tick={{ fontSize: 10, fill: "#94a3b8" }}
                label={{ value: "dB", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "#141b2d", border: "1px solid #2a3454", borderRadius: "6px", fontSize: "12px" }}
                labelFormatter={v => `f = ${Number(v).toFixed(3)}`}
                formatter={v => [`${Number(v).toFixed(1)} dB`, "PSD"]}
              />
              <Line type="monotone" dataKey="psd" stroke="#22d3ee" strokeWidth={1.2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-60 flex items-center justify-center text-xs text-ink-dim">No data yet</div>
        )}
      </section>

      {/* METRICS */}
      {specData && (
        <section className="panel p-5">
          <div className="section-title mb-3">LPI metrics</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Spectral flatness ξ"
              value={`${(specData.spectral_flatness * 100).toFixed(1)}%`}
              note="higher = more noise-like"
              good={specData.spectral_flatness > 0.5} />
            <Stat label="Spectral entropy H"
              value={`${(specData.spectral_entropy_normalized * 100).toFixed(1)}%`}
              note="of max entropy"
              good={specData.spectral_entropy_normalized > 0.7} />
            <Stat label="Peak-to-avg ratio"
              value={`${specData.peak_to_average_db.toFixed(1)} dB`}
              note="lower = flatter"
              good={specData.peak_to_average_db < 5} />
            <Stat label="3dB bandwidth"
              value={specData.bandwidth_3db.toFixed(4)}
              note="normalized" />
          </div>
        </section>
      )}

      {/* MULTI-MAP COMPARISON */}
      {compareChartData.length > 0 && (
        <section className="panel p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink">PSD comparison — 4 maps</div>
            <div className="caption-mono">tent and PWLCM are flattest (uniform invariant measure)</div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={compareChartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
              <XAxis dataKey="freq" type="number"
                stroke="#94a3b8" tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickFormatter={v => Number(v).toFixed(2)}
              />
              <YAxis stroke="#94a3b8" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#141b2d", border: "1px solid #2a3454", borderRadius: "6px", fontSize: "12px" }}
                labelFormatter={v => `f = ${Number(v).toFixed(3)}`}
              />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              {compareData.results.map((r, i) => (
                <Line key={i} type="monotone" dataKey={`s${i}`} name={r.name}
                  stroke={LINE_COLORS[i]} strokeWidth={1.2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>

          {/* Flatness comparison table */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            {compareData.results.map((r, i) => (
              <div key={i} className="rounded-md border border-bg-line bg-bg-base/40 p-3">
                <div className="text-[10px] font-semibold mb-1" style={{ color: LINE_COLORS[i] }}>
                  {r.name}
                </div>
                <div className="caption-mono">ξ = {(r.spectral_flatness * 100).toFixed(1)}%</div>
                <div className="caption-mono">H = {(r.spectral_entropy_normalized * 100).toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CONCEPT CARDS */}
      {explainers && (
        <section className="space-y-3">
          <div className="section-title px-1">Deep dive</div>
          <LearnerCard title="Spectral flatness — the Wiener entropy" defaultOpen={false} icon="ξ">
            <p>{explainers.spectral_flatness}</p>
          </LearnerCard>
          <LearnerCard title="Spectral entropy" defaultOpen={false} icon="H">
            <p>{explainers.spectral_entropy}</p>
          </LearnerCard>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, note, good }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-ink-dim">{label}</div>
      <div className={`font-mono text-lg ${good === true ? "text-phosphor" : good === false ? "text-crimson" : "text-ink"}`}>
        {value}
      </div>
      {note && <div className="text-[10px] text-ink-dim">{note}</div>}
    </div>
  );
}