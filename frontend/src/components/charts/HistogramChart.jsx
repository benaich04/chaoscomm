import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

/**
 * HistogramChart — approximates the invariant measure of the chaotic orbit.
 *
 * Build a histogram of the post-transient orbit values and plot it.
 * Mathematically this is an empirical density estimate of the map's
 * invariant probability measure — for the logistic at r=4 it matches the
 * arcsine distribution 1/(π√(x(1-x))).
 *
 * Props:
 *   orbit    — number[]
 *   domain   — [lo, hi]
 *   nBins    — number of histogram bins (default 40)
 */

function buildHistogram(orbit, domain, nBins) {
  const [lo, hi] = domain;
  const span = hi - lo;
  const counts = new Array(nBins).fill(0);
  const skip = Math.min(200, Math.floor(orbit.length * 0.1));
  for (let i = skip; i < orbit.length; i++) {
    const v = orbit[i];
    if (v < lo || v > hi || !Number.isFinite(v)) continue;
    let bin = Math.floor(((v - lo) / span) * nBins);
    if (bin >= nBins) bin = nBins - 1;
    if (bin < 0) bin = 0;
    counts[bin]++;
  }
  const totalSamples = orbit.length - skip;
  const binWidth = span / nBins;
  return counts.map((c, i) => ({
    x: lo + (i + 0.5) * binWidth,
    density: totalSamples > 0 ? c / (totalSamples * binWidth) : 0,
  }));
}

export default function HistogramChart({ orbit, domain = [0, 1], nBins = 40 }) {
  if (!orbit || orbit.length < 50) {
    return (
      <div className="h-60 flex items-center justify-center text-xs text-ink-dim">
        Need more samples to estimate density
      </div>
    );
  }
  const data = buildHistogram(orbit, domain, nBins);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
        <XAxis
          dataKey="x"
          stroke="#94a3b8"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          tickFormatter={(v) => Number(v).toFixed(2)}
          label={{ value: "x", position: "insideBottomRight", offset: -2, fill: "#94a3b8", fontSize: 10 }}
        />
        <YAxis
          stroke="#94a3b8"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          label={{ value: "p(x)", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#141b2d",
            border: "1px solid #2a3454",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "#94a3b8" }}
          itemStyle={{ color: "#fbbf24" }}
          formatter={(v) => [Number(v).toFixed(3), "p(x)"]}
          labelFormatter={(v) => `x = ${Number(v).toFixed(3)}`}
        />
        <Bar dataKey="density" fill="#fbbf24" fillOpacity={0.65} stroke="#fbbf24" strokeWidth={0.4} />
      </BarChart>
    </ResponsiveContainer>
  );
}