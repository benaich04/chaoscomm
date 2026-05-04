import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
} from "recharts";

const API = "http://localhost:8000";

const MAPS = ["logistic", "tent", "bernoulli", "chebyshev"];

export default function MetricsPage() {
  const [mapName, setMapName] = useState("logistic");
  const [n, setN] = useState(2048);
  const [r, setR] = useState(3.9);
  const [levels, setLevels] = useState(16);

  const [single, setSingle] = useState(null);
  const [compare, setCompare] = useState(null);
  const [explainers, setExplainers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function runMetrics() {
    setBusy(true);
    setError(null);

    try {
      const common = {
        n,
        x0: 0.31415,
        r,
        levels,
      };

      const [singleRes, compareRes] = await Promise.all([
        fetch(`${API}/api/metrics/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...common, map_name: mapName }),
        }),
        fetch(`${API}/api/metrics/compare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(common),
        }),
      ]);

      if (!singleRes.ok) throw new Error(`Analyze failed: ${singleRes.status}`);
      if (!compareRes.ok) throw new Error(`Compare failed: ${compareRes.status}`);

      setSingle(await singleRes.json());
      setCompare(await compareRes.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    fetch(`${API}/api/metrics/explainers`)
      .then((r) => r.json())
      .then(setExplainers)
      .catch(() => {});
  }, []);

  useEffect(() => {
    runMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sequenceData = useMemo(() => {
    if (!single?.sequence_preview) return [];
    return single.sequence_preview.map((v, i) => ({ i, value: v }));
  }, [single]);

  const histogramData = useMemo(() => {
    if (!single?.histogram) return [];
    return single.histogram.bins.map((b, i) => ({
      bin: Number(b).toFixed(2),
      count: single.histogram.counts[i],
    }));
  }, [single]);

  const metricCards = single?.metrics
    ? [
        ["Lyapunov", single.metrics.lyapunov.toFixed(3), "Sensitivity to tiny changes"],
        ["Entropy", single.metrics.entropy.toFixed(3), "Value unpredictability"],
        ["Spectral Flatness", single.metrics.spectral_flatness.toFixed(3), "Noise-like spectrum"],
        ["BCR", single.metrics.bin_crossing_rate.toFixed(3), "Digital bin movement"],
        ["QA Chaos Score", single.metrics.qa_chaos_score.toFixed(1), "Your combined score"],
        ["Autocorr PSLR", `${single.metrics.autocorr_pslr_db.toFixed(1)} dB`, "Correlation sidelobe quality"],
      ]
    : [];

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">
      <section className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">
          MODULE · METRICS DASHBOARD
        </div>

        <h1 className="text-3xl font-semibold tracking-tight mb-2">
          Metrics Dashboard — How Good Is the Chaos?
        </h1>

        <p className="text-ink-muted text-sm max-w-3xl">
          This page turns chaotic signals into engineering numbers: randomness,
          signal quality, security strength, and your custom quantization-aware score.
        </p>
      </section>

      <section className="panel p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">
              Map
            </div>
            <div className="flex flex-wrap gap-2">
              {MAPS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMapName(m)}
                  className={`px-3 py-1.5 rounded text-xs border ${
                    mapName === m
                      ? "bg-amber/15 text-amber border-amber/40"
                      : "bg-bg-base border-bg-line text-ink-muted hover:text-ink"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <Slider label="Sequence length" value={n} min={256} max={10000} step={256} onChange={setN} />
          <Slider label="Map parameter r" value={r} min={0.1} max={4.0} step={0.01} onChange={setR} />
          <Slider label="Quantization levels" value={levels} min={2} max={256} step={1} onChange={setLevels} />
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={runMetrics}
            disabled={busy}
            className="px-5 py-2 rounded-md bg-amber/20 text-amber border border-amber/40 hover:bg-amber/30 disabled:opacity-50"
          >
            {busy ? "computing…" : "▶ Run metrics"}
          </button>

          {error && <span className="text-crimson text-xs font-mono">{error}</span>}
        </div>
      </section>

      {single && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {metricCards.map(([title, value, note]) => (
              <MetricCard key={title} title={title} value={value} note={note} />
            ))}
          </section>

          <section className="panel p-5">
            <div className="mb-3">
              <div className="text-sm font-semibold text-ink">
                Personal Contribution: Quantization-Aware Chaos Score
              </div>
              <div className="caption-mono">
                combines entropy + Lyapunov + spectral flatness + bin-crossing behavior
              </div>
            </div>

            <div className="rounded-md border border-amber/30 bg-amber/10 p-4">
              <div className="text-2xl font-mono text-amber">
                {single.metrics.qa_chaos_score.toFixed(1)} / 100
              </div>
              <div className="text-sm text-ink-muted mt-2">
                This score estimates whether the chaotic signal remains useful after
                digitization. A high score means the signal is random-looking, spreads
                across bins well, and has good sensitivity.
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel title="Sequence Preview" caption="first 250 samples of the chaotic sequence">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={sequenceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
                  <XAxis dataKey="i" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="value" stroke="#22d3ee" dot={false} strokeWidth={1.3} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Distribution Histogram" caption="shows how evenly values fill the interval">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={histogramData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
                  <XAxis dataKey="bin" stroke="#94a3b8" tick={{ fontSize: 9 }} interval={3} />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill="#fbbf24" />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </section>

          <section className="panel p-5">
            <div className="mb-3">
              <div className="text-sm font-semibold text-ink">
                Randomness Test Table
              </div>
              <div className="caption-mono">
                lightweight NIST-style checks for balance, runs, blocks, and spectrum
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-ink-dim border-b border-bg-line">
                    <th className="text-left py-2">Test</th>
                    <th className="text-left py-2">p-value</th>
                    <th className="text-left py-2">Result</th>
                    <th className="text-left py-2">Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {single.tests.map((t) => (
                    <tr key={t.name} className="border-b border-bg-line/30">
                      <td className="py-2 text-ink">{t.name}</td>
                      <td className="py-2 text-amber">{t.p_value.toFixed(4)}</td>
                      <td className="py-2">
                        <span
                          className={`px-2 py-1 rounded border ${
                            t.passed
                              ? "text-green-400 border-green-400/40 bg-green-400/10"
                              : "text-red-400 border-red-400/40 bg-red-400/10"
                          }`}
                        >
                          {t.passed ? "PASS" : "FAIL"}
                        </span>
                      </td>
                      <td className="py-2 text-ink-muted">{t.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {compare && (
        <section className="panel p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink">
              Map Comparison Radar Chart
            </div>
            <div className="caption-mono">
              higher area = stronger overall chaotic signal quality
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={380}>
                <RadarChart data={compare.radar_chart}>
                  <PolarGrid stroke="#2a3454" />
                  <PolarAngleAxis dataKey="map" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis stroke="#94a3b8" tick={{ fontSize: 9 }} />
                  <Radar name="Entropy" dataKey="Entropy" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.12} />
                  <Radar name="Lyapunov" dataKey="Lyapunov" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.10} />
                  <Radar name="Flatness" dataKey="Flatness" stroke="#10b981" fill="#10b981" fillOpacity={0.10} />
                  <Radar name="BCR" dataKey="BCR" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.10} />
                  <Radar name="QA Score" dataKey="QA Score" stroke="#ef4444" fill="#ef4444" fillOpacity={0.08} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Tooltip contentStyle={tooltipStyle} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-md border border-bg-line bg-bg-base/50 p-4">
              <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">
                Best Current Map
              </div>
              <div className="text-2xl font-semibold text-amber capitalize">
                {compare.summary.best_map}
              </div>
              <div className="text-xl font-mono text-cyan mt-2">
                {compare.summary.best_score.toFixed(1)} / 100
              </div>
              <p className="text-sm text-ink-muted mt-3">
                {compare.summary.explanation}
              </p>
            </div>
          </div>
        </section>
      )}

      {explainers && (
        <section className="panel p-5">
          <div className="text-sm font-semibold text-ink mb-3">How to read this page</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-ink-muted">
            <Info label="Lyapunov" text={explainers.lyapunov} />
            <Info label="Entropy" text={explainers.entropy} />
            <Info label="Spectral Flatness" text={explainers.spectral_flatness} />
            <Info label="BCR" text={explainers.bcr} />
            <Info label="QA Score" text={explainers.qa_score} />
            <Info label="Randomness Tests" text={explainers.nist} />
          </div>
        </section>
      )}
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: "#141b2d",
  border: "1px solid #2a3454",
  borderRadius: "6px",
  fontSize: "11px",
};

function Slider({ label, value, min, max, step, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-widest text-ink-dim">{label}</span>
        <span className="font-mono text-sm text-amber">
          {Number(value).toFixed(step < 0.1 ? 2 : 0)}
        </span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber"
      />

      <div className="flex justify-between mt-1 text-[10px] text-ink-dim">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function MetricCard({ title, value, note }) {
  return (
    <div className="panel p-4">
      <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">{title}</div>
      <div className="text-xl font-mono text-cyan">{value}</div>
      <div className="caption-mono mt-2">{note}</div>
    </div>
  );
}

function Panel({ title, caption, children }) {
  return (
    <section className="panel p-5">
      <div className="mb-3">
        <div className="text-sm font-semibold text-ink">{title}</div>
        <div className="caption-mono">{caption}</div>
      </div>
      {children}
    </section>
  );
}

function Info({ label, text }) {
  return (
    <div className="rounded-md border border-bg-line bg-bg-base/50 p-3">
      <div className="text-cyan font-semibold mb-1">{label}</div>
      <div>{text}</div>
    </div>
  );
}
