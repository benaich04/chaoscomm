import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea,
} from "recharts";

/**
 * LyapunovSpectrumChart — λ(r) curve plotted on the same parameter axis
 * as the bifurcation diagram above.
 *
 * Behaviour notes:
 *
 *  - x-axis is locked to (pMin, pMax) supplied by the parent so it always
 *    matches the bifurcation chart, even mid-update.
 *
 *  - y-axis is *hard-clamped* to a readable range.  Some maps produce
 *    extreme negative λ values (e.g. tent at μ=0 has |f'|=0 → log≈-708).
 *    Those would squash the rest of the curve to a single pixel.  We
 *    clamp values to [-3, 1.5] for display, which spans the practical
 *    range for every map in the registry while keeping the visual
 *    distinction between "stable" and "chaotic" regions readable.
 */

const Y_FLOOR = -3.0;
const Y_CEILING = 1.5;

export default function LyapunovSpectrumChart({
  param, lyapunov, pMin, pMax, lockedR = null, height = 200,
}) {
  if (!param || !lyapunov || param.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-xs text-ink-dim">
        No λ(r) data yet
      </div>
    );
  }

  // Build series with clamped y-values so outliers don't blow up the
  // y-axis scaling.  We keep clamped points (rather than drop them) so
  // the line has no gaps; landing on the floor clearly indicates a
  // "very stable / tiny derivative" region.
  const data = param.map((r, i) => {
    const raw = Number(lyapunov[i]);
    const clamped = Math.max(Y_FLOOR, Math.min(Y_CEILING, raw));
    return { r, lam: clamped };
  });

  // Drop any out-of-range points.
  const inRange = (pMin != null && pMax != null)
    ? data.filter(d => d.r >= pMin - 1e-9 && d.r <= pMax + 1e-9)
    : data;
  const series = inRange.length > 0 ? inRange : data;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={series} margin={{ top: 10, right: 18, left: 36, bottom: 14 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
        <XAxis
          dataKey="r"
          type="number"
          domain={[pMin, pMax]}
          allowDataOverflow
          stroke="#94a3b8"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          tickFormatter={(v) => Number(v).toFixed(2)}
          label={{ value: "parameter", position: "insideBottomRight", offset: -2, fill: "#94a3b8", fontSize: 10 }}
        />
        <YAxis
          domain={[Y_FLOOR, Y_CEILING]}
          allowDataOverflow
          stroke="#94a3b8"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          tickFormatter={(v) => Number(v).toFixed(1)}
          label={{ value: "λ", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 11 }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#141b2d",
            border: "1px solid #2a3454",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "#94a3b8" }}
          itemStyle={{ color: "#22d3ee" }}
          labelFormatter={(v) => `r = ${Number(v).toFixed(4)}`}
          formatter={(v) => [Number(v).toFixed(4), "λ"]}
        />
        <ReferenceArea y1={0} y2={Y_CEILING} fill="#10b981" fillOpacity={0.06} />
        <ReferenceLine y={0} stroke="#10b981" strokeWidth={1} strokeDasharray="4 4" />
        {lockedR != null && (
          <ReferenceLine x={lockedR} stroke="#22d3ee" strokeDasharray="3 3" />
        )}
        <Line
          type="monotone"
          dataKey="lam"
          stroke="#22d3ee"
          strokeWidth={1.4}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}