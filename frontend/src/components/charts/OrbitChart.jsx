import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

/**
 * OrbitChart — time-series visualisation of x_n vs n.
 *
 * Down-samples to ~600 points for rendering performance even when the
 * orbit has 10,000 — recharts is happy with thousands of points but
 * over a few thousand we get noticeable interaction lag, and visually
 * the difference is invisible.
 *
 * Props:
 *   orbit  — number[]   the iterated sequence
 *   domain — [lo, hi]   y-axis range (e.g. [0,1] for logistic, [-1,1] for cubic)
 *   showFirst — number  if set, only show the first N samples (useful for
 *                       seeing transient + period clearly)
 */

const MAX_POINTS = 600;

function downsample(arr, maxPoints) {
  if (arr.length <= maxPoints) return arr;
  const step = arr.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(arr[Math.floor(i * step)]);
  }
  return out;
}

export default function OrbitChart({ orbit, domain = [0, 1], showFirst = null }) {
  if (!orbit || orbit.length === 0) {
    return <ChartEmpty label="No orbit data yet" />;
  }

  const sliced = showFirst ? orbit.slice(0, showFirst) : orbit;
  const displayed = downsample(sliced, MAX_POINTS);
  const data = displayed.map((y, i) => ({
    n: showFirst ? i : Math.floor((i / displayed.length) * sliced.length),
    x: y,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
        <XAxis
          dataKey="n"
          stroke="#94a3b8"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          label={{ value: "n", position: "insideBottomRight", offset: -2, fill: "#94a3b8", fontSize: 10 }}
        />
        <YAxis
          domain={domain}
          stroke="#94a3b8"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          label={{ value: "xₙ", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }}
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
          formatter={(v) => [Number(v).toFixed(6), "xₙ"]}
        />
        <Line
          type="monotone"
          dataKey="x"
          stroke="#22d3ee"
          strokeWidth={1.2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ChartEmpty({ label }) {
  return (
    <div className="h-60 flex items-center justify-center text-xs text-ink-dim">
      {label}
    </div>
  );
}