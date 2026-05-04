import { useEffect, useMemo, useState } from "react";
import PlotlyComponent from "react-plotly.js";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

const Plot = PlotlyComponent.default || PlotlyComponent;
const API = "https://chaoscomm.onrender.com";

export default function RadarPage() {
  const [delay, setDelay] = useState(20);
  const [doppler, setDoppler] = useState(0.05);
  const [snrDb, setSnrDb] = useState(20);
  const [length, setLength] = useState(256);

  const [data, setData] = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function runRadar() {
    setBusy(true);
    setError(null);

    try {
      const body = JSON.stringify({
        length,
        delay,
        doppler,
        snr_db: snrDb,
      });

      const [simRes, compareRes] = await Promise.all([
        fetch(`${API}/api/radar/simulate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }),
        fetch(`${API}/api/radar/compare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }),
      ]);

      if (!simRes.ok) throw new Error(`Radar simulate failed: ${simRes.status}`);
      if (!compareRes.ok) throw new Error(`Radar compare failed: ${compareRes.status}`);

      setData(await simRes.json());
      setCompareData(await compareRes.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    runRadar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const waveformData = useMemo(() => {
    if (!data) return [];
    const n = Math.min(data.tx.length, data.rx.length);
    return Array.from({ length: n }, (_, i) => ({
      i,
      tx: data.tx[i],
      rx: data.rx[i],
    }));
  }, [data]);

  const rangeData = useMemo(() => {
    if (!data) return [];
    return data.range_profile.map((v, i) => ({
      delay: i,
      value: v,
      threshold: data.threshold,
    }));
  }, [data]);

  const processors = compareData?.processors || [];

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">
      <section className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">
          MODULE · CHAOTIC RADAR
        </div>

        <h1 className="text-3xl font-semibold tracking-tight mb-2">
          Chaotic Radar — Range, Doppler, and Detection
        </h1>

        <p className="text-ink-muted text-sm max-w-3xl">
          This page compares different radar processors on the same chaotic echo.
          The main idea is simple: matched filtering knows the signal pattern, so it
          can recover the target even when other methods struggle.
        </p>
      </section>

      <section className="panel p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          <Slider label="Target delay" value={delay} min={0} max={120} step={1} unit="samples" onChange={setDelay} />
          <Slider label="Doppler" value={doppler} min={-0.1} max={0.1} step={0.005} unit="" onChange={setDoppler} />
          <Slider label="SNR" value={snrDb} min={-10} max={40} step={1} unit="dB" onChange={setSnrDb} />
          <Slider label="Pulse length" value={length} min={64} max={512} step={64} unit="samples" onChange={setLength} />
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={runRadar}
            disabled={busy}
            className="px-5 py-2 rounded-md bg-amber/20 text-amber border border-amber/40 hover:bg-amber/30 disabled:opacity-50"
          >
            {busy ? "running…" : "▶ Run radar comparison"}
          </button>

          {error && <span className="text-crimson text-xs font-mono">{error}</span>}
        </div>
      </section>

      {data && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard title="Target Delay" value={`${delay} samples`} />
            <MetricCard title="Doppler Shift" value={doppler.toFixed(3)} />
            <MetricCard title="SNR" value={`${snrDb} dB`} />
            <MetricCard title="Detections" value={data.detections?.length ? data.detections.slice(0, 3).join(", ") : "none"} />
          </section>

          <section className="panel p-5">
            <div className="mb-3">
              <div className="text-sm font-semibold text-ink">Transmitted vs Received Echo</div>
              <div className="caption-mono">received echo is delayed, Doppler-shifted, and corrupted by noise</div>
            </div>

            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={waveformData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
                <XAxis dataKey="i" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: "#141b2d", border: "1px solid #2a3454", borderRadius: "6px", fontSize: "11px" }} />
                <Line type="monotone" dataKey="tx" stroke="#22d3ee" dot={false} strokeWidth={1.5} name="Transmitted" />
                <Line type="monotone" dataKey="rx" stroke="#fbbf24" dot={false} strokeWidth={1.2} name="Received" />
              </LineChart>
            </ResponsiveContainer>
          </section>

          <section className="panel p-5">
            <div className="mb-3">
              <div className="text-sm font-semibold text-ink">Matched Filter Range Profile</div>
              <div className="caption-mono">target appears as a correlation peak; dashed line is CFAR threshold</div>
            </div>

            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={rangeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
                <XAxis dataKey="delay" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: "#141b2d", border: "1px solid #2a3454", borderRadius: "6px", fontSize: "11px" }} />
                <ReferenceLine y={data.threshold} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "CFAR", fill: "#ef4444", fontSize: 10 }} />
                <ReferenceLine x={delay} stroke="#fbbf24" strokeDasharray="3 3" label={{ value: "true delay", fill: "#fbbf24", fontSize: 10 }} />
                <Line type="monotone" dataKey="value" stroke="#10b981" dot={false} strokeWidth={1.7} name="Matched filter output" />
              </LineChart>
            </ResponsiveContainer>
          </section>
        </>
      )}

      {processors.length > 0 && (
        <section className="panel p-5">
          <div className="mb-4">
            <div className="text-sm font-semibold text-ink">Radar Processor Comparison</div>
            <div className="caption-mono">
              Same target, same noise, same Doppler — different processing methods.
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {processors.map((p) => (
              <div key={p.key} className="rounded-md border border-bg-line bg-bg-base/40 p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="text-sm font-semibold text-ink">{p.title}</div>
                    <div className="caption-mono">{p.description}</div>
                  </div>

                  <QualityBadge quality={p.metrics.quality} />
                </div>

                <Plot
                  data={[
                    {
                      z: p.surface,
                      x: compareData.delays,
                      y: compareData.dopplers,
                      type: "surface",
                      colorscale: "YlOrBr",
                      showscale: false,
                    },
                  ]}
                  layout={{
                    autosize: true,
                    height: 300,
                    margin: { l: 0, r: 0, b: 0, t: 0 },
                    paper_bgcolor: "#0b1220",
                    plot_bgcolor: "#0b1220",
                    scene: {
                      xaxis: { title: "Delay", color: "#94a3b8" },
                      yaxis: { title: "Doppler", color: "#94a3b8" },
                      zaxis: { title: "Strength", color: "#94a3b8" },
                    },
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: "100%" }}
                />

                <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-mono">
                  <MiniMetric label="Confidence" value={p.metrics.confidence_score.toFixed(2)} />
                  <MiniMetric label="Peak" value={p.metrics.peak.toFixed(1)} />
                  <MiniMetric label="Background" value={p.metrics.background_mean.toFixed(1)} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-widest text-ink-dim">{label}</span>
        <span className="font-mono text-sm text-amber">
          {typeof value === "number" ? value.toFixed(step < 0.01 ? 3 : 0) : value}
          {unit ? ` ${unit}` : ""}
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

function MetricCard({ title, value }) {
  return (
    <div className="panel p-4">
      <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">{title}</div>
      <div className="text-xl font-mono text-cyan">{value}</div>
    </div>
  );
}

function MiniMetric({ label, value }) {
  return (
    <div className="rounded border border-bg-line bg-bg-base/60 p-2">
      <div className="text-[9px] uppercase tracking-widest text-ink-dim">{label}</div>
      <div className="text-ink">{value}</div>
    </div>
  );
}

function QualityBadge({ quality }) {
  const cls =
    quality === "High"
      ? "text-green-400 border-green-400/40 bg-green-400/10"
      : quality === "Medium"
      ? "text-yellow-400 border-yellow-400/40 bg-yellow-400/10"
      : "text-red-400 border-red-400/40 bg-red-400/10";

  return (
    <div className={`px-2 py-1 rounded border text-[10px] font-mono uppercase ${cls}`}>
      {quality}
    </div>
  );
}