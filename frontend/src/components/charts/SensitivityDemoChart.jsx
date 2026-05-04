import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from "recharts";

/**
 * SensitivityDemoChart — the butterfly-effect visualizer.
 *
 * Shows two sub-charts stacked:
 *   1. Top: both orbits overlaid (cyan + amber).  They start nearly
 *      identical and then diverge wildly.
 *   2. Bottom: log₁₀|x_n - y_n| vs n.  This is a straight line whose
 *      slope ≈ λ / ln(10) — the user can literally *read* the Lyapunov
 *      exponent off the graph as a slope.
 *
 * This is the single most pedagogically powerful demo on the platform.
 * When you see two sequences that started 10⁻¹² apart become completely
 * uncorrelated after ~40 iterations, you *understand* chaos.
 *
 * Props:
 *   orbitA, orbitB — number[]  (same map, same params, different x₀)
 *   lyapunov      — number    (λ for slope comparison line)
 *   epsilon       — number    (initial separation |x₀ᴬ - x₀ᴮ|)
 *   domain        — [lo, hi]
 */

export default function SensitivityDemoChart({
  orbitA, orbitB, lyapunov = null, epsilon = 1e-10, domain = [0, 1],
}) {
  if (!orbitA || !orbitB || orbitA.length < 10 || orbitB.length < 10) {
    return (
      <div className="h-80 flex items-center justify-center text-xs text-ink-dim">
        Waiting for two orbits…
      </div>
    );
  }

  const len = Math.min(orbitA.length, orbitB.length, 500);

  // Build both data arrays
  const overlayData = [];
  const diffData = [];
  for (let i = 0; i < len; i++) {
    overlayData.push({ n: i, a: orbitA[i], b: orbitB[i] });
    const diff = Math.abs(orbitA[i] - orbitB[i]);
    const logDiff = diff > 0 ? Math.log10(diff) : -16;
    diffData.push({ n: i, logDiff });
  }

  // Theoretical slope line: log₁₀(ε·exp(λ·n)) = log₁₀(ε) + λ·n/ln(10)
  const slopeData = lyapunov != null ? (() => {
    const log10eps = Math.log10(epsilon);
    const slopePerStep = lyapunov / Math.LN10;
    const pts = [];
    for (let n = 0; n < len; n++) {
      const y = log10eps + slopePerStep * n;
      if (y > 2) break; // clamp visual
      pts.push({ n, theory: y });
    }
    return pts;
  })() : null;

  return (
    <div className="space-y-4">
      {/* Top: overlay of both orbits */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">
          Both orbits overlaid (first {len} iterations)
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={overlayData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
            <XAxis
              dataKey="n" stroke="#94a3b8"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
            />
            <YAxis
              domain={domain} stroke="#94a3b8"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "#141b2d", border: "1px solid #2a3454", borderRadius: "6px", fontSize: "12px" }}
              labelStyle={{ color: "#94a3b8" }}
            />
            <Legend
              wrapperStyle={{ fontSize: "11px" }}
              iconType="line"
            />
            <Line type="monotone" dataKey="a" name="orbit A" stroke="#22d3ee" strokeWidth={1.2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="b" name="orbit B" stroke="#fbbf24" strokeWidth={1.2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom: log divergence */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">
          Divergence: log₁₀|xₙᴬ − xₙᴮ| vs n
          {lyapunov != null && (
            <span className="ml-2 text-amber">
              slope ≈ λ/ln(10) = {(lyapunov / Math.LN10).toFixed(3)}
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={diffData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
            <XAxis
              dataKey="n" stroke="#94a3b8"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              label={{ value: "n", position: "insideBottomRight", offset: -2, fill: "#94a3b8", fontSize: 10 }}
            />
            <YAxis
              domain={[-16, 1]}
              stroke="#94a3b8"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              label={{ value: "log₁₀|Δx|", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "#141b2d", border: "1px solid #2a3454", borderRadius: "6px", fontSize: "12px" }}
              labelStyle={{ color: "#94a3b8" }}
              formatter={(v) => [Number(v).toFixed(2), "log₁₀|Δx|"]}
            />
            <Line type="monotone" dataKey="logDiff" name="measured" stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            {slopeData && (
              <Line
                data={slopeData}
                type="monotone"
                dataKey="theory"
                name={`theory: slope = λ/ln10`}
                stroke="#fbbf24"
                strokeWidth={1}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}