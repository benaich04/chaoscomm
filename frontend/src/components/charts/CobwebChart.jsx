/**
 * CobwebChart — the canonical "cobweb" visualisation of an iterated map.
 *
 * Shows three curves on one square plot:
 *   - the diagonal y = x  (dim white)
 *   - the function f(x)   (cyan)
 *   - the cobweb polyline traversed by the iteration (amber)
 *
 * Reading the picture: pick an x₀ on the x-axis, go vertically up to the
 * f(x) curve, that height equals f(x₀) = x₁.  Then go horizontally to the
 * diagonal — this transfers x₁ from being a *y-value* to being the next
 * x-input.  Repeat.  The trajectory either spirals into a fixed point
 * (cobweb shrinks), settles into a closed rectangle (period-2), or
 * fills the square chaotically.
 *
 * Implemented as raw SVG because Recharts has no primitive for this and
 * the shape is genuinely simple (~1 polyline + 2 polyline curves).
 */

const PAD = 32;        // padding around the square plot
const SIZE = 320;      // total SVG size
const PLOT = SIZE - 2 * PAD;

export default function CobwebChart({ data, domain = [0, 1] }) {
  if (!data || !data.f_curve_x || data.f_curve_x.length === 0) {
    return (
      <div className="h-80 flex items-center justify-center text-xs text-ink-dim">
        No cobweb data yet
      </div>
    );
  }

  const [lo, hi] = domain;
  const span = hi - lo;
  const toPx = (x) => PAD + ((x - lo) / span) * PLOT;
  const toPy = (y) => PAD + PLOT - ((y - lo) / span) * PLOT;

  // f(x) curve points
  const fPoints = data.f_curve_x
    .map((x, i) => {
      const y = data.f_curve_y[i];
      if (!Number.isFinite(y)) return null;
      // Clamp to domain visually (the math is fine, we just don't draw outside)
      const yc = Math.max(lo, Math.min(hi, y));
      return `${toPx(x).toFixed(2)},${toPy(yc).toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");

  // Cobweb polyline points
  const cobPoints = data.cobweb_points
    .map(([x, y]) => `${toPx(x).toFixed(2)},${toPy(y).toFixed(2)}`)
    .join(" ");

  return (
    <div className="flex justify-center">
      <svg
        width={SIZE} height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="bg-bg-base rounded-md border border-bg-line"
      >
        {/* Grid */}
        <defs>
          <pattern id="cobweb-grid" width={PLOT / 5} height={PLOT / 5} patternUnits="userSpaceOnUse">
            <path d={`M ${PLOT / 5} 0 L 0 0 0 ${PLOT / 5}`} fill="none" stroke="#2a3454" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect x={PAD} y={PAD} width={PLOT} height={PLOT} fill="url(#cobweb-grid)" />

        {/* Box */}
        <rect x={PAD} y={PAD} width={PLOT} height={PLOT}
              fill="none" stroke="#2a3454" strokeWidth="1" />

        {/* y = x diagonal */}
        <line
          x1={toPx(lo)} y1={toPy(lo)}
          x2={toPx(hi)} y2={toPy(hi)}
          stroke="#64748b" strokeWidth="0.8" strokeDasharray="3 3"
        />

        {/* f(x) curve */}
        <polyline points={fPoints} fill="none" stroke="#22d3ee" strokeWidth="1.5" />

        {/* Cobweb polyline */}
        <polyline points={cobPoints} fill="none" stroke="#fbbf24" strokeWidth="1" opacity="0.85" />

        {/* Starting point marker */}
        {data.cobweb_points.length > 0 && (
          <circle
            cx={toPx(data.cobweb_points[0][0])}
            cy={toPy(data.cobweb_points[0][1])}
            r="3"
            fill="#fbbf24"
            stroke="#0a0e1a" strokeWidth="1"
          />
        )}

        {/* Axis labels */}
        <text x={SIZE / 2} y={SIZE - 6} textAnchor="middle"
              fill="#94a3b8" fontSize="10" fontFamily="JetBrains Mono">
          xₙ
        </text>
        <text x={10} y={SIZE / 2} textAnchor="middle"
              fill="#94a3b8" fontSize="10" fontFamily="JetBrains Mono"
              transform={`rotate(-90, 10, ${SIZE / 2})`}>
          xₙ₊₁ = f(xₙ)
        </text>

        {/* Domain ticks */}
        <text x={toPx(lo)} y={SIZE - PAD + 14} textAnchor="middle"
              fill="#64748b" fontSize="9" fontFamily="JetBrains Mono">{lo}</text>
        <text x={toPx(hi)} y={SIZE - PAD + 14} textAnchor="middle"
              fill="#64748b" fontSize="9" fontFamily="JetBrains Mono">{hi}</text>
        <text x={PAD - 4} y={toPy(hi) + 3} textAnchor="end"
              fill="#64748b" fontSize="9" fontFamily="JetBrains Mono">{hi}</text>
        <text x={PAD - 4} y={toPy(lo) + 3} textAnchor="end"
              fill="#64748b" fontSize="9" fontFamily="JetBrains Mono">{lo}</text>

        {/* Legend */}
        <g transform={`translate(${PAD + 6}, ${PAD + 6})`}>
          <rect x="0" y="0" width="92" height="52" fill="#0a0e1a" stroke="#2a3454" rx="3" />
          <line x1="6" y1="14" x2="22" y2="14" stroke="#22d3ee" strokeWidth="1.5" />
          <text x="28" y="17" fill="#e2e8f0" fontSize="10" fontFamily="Inter">f(x)</text>
          <line x1="6" y1="28" x2="22" y2="28" stroke="#fbbf24" strokeWidth="1.2" />
          <text x="28" y="31" fill="#e2e8f0" fontSize="10" fontFamily="Inter">cobweb</text>
          <line x1="6" y1="42" x2="22" y2="42" stroke="#64748b" strokeWidth="0.8" strokeDasharray="3 3" />
          <text x="28" y="45" fill="#e2e8f0" fontSize="10" fontFamily="Inter">y = x</text>
        </g>
      </svg>
    </div>
  );
}