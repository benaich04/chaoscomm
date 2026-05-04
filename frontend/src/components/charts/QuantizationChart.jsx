import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

/**
 * QuantizationChart — overlays original orbit and quantized output.
 *
 * Shows:
 *   - Cyan line: original chaotic signal xₙ
 *   - Amber step-line: quantized x̂ₙ = Q(xₙ)
 *   - Horizontal dashed lines at each reconstruction level
 *
 * Limited to ~200 samples for readability — quantization effects are
 * visible even on short sequences.
 */

export default function QuantizationChart({
  original, quantized, levels = [], domain = [0, 1], showFirst = 200,
}) {
  if (!original || !quantized || original.length < 2) {
    return (
      <div className="h-60 flex items-center justify-center text-xs text-ink-dim">
        No quantization data yet
      </div>
    );
  }

  const n = Math.min(original.length, quantized.length, showFirst);
  const data = [];
  for (let i = 0; i < n; i++) {
    data.push({ n: i, orig: original[i], quant: quantized[i] });
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
        <XAxis
          dataKey="n" stroke="#94a3b8"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          label={{ value: "n", position: "insideBottomRight", offset: -2, fill: "#94a3b8", fontSize: 10 }}
        />
        <YAxis
          domain={domain} stroke="#94a3b8"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#141b2d", border: "1px solid #2a3454", borderRadius: "6px", fontSize: "12px" }}
          labelStyle={{ color: "#94a3b8" }}
          formatter={(v, name) => [Number(v).toFixed(5), name === "orig" ? "original" : "quantized"]}
        />
        {/* Reconstruction levels as horizontal dashed lines */}
        {levels.slice(0, 32).map((lv, i) => (
          <ReferenceLine
            key={i} y={lv}
            stroke="#fbbf24" strokeOpacity={0.25} strokeDasharray="2 4"
          />
        ))}
        <Line type="monotone" dataKey="orig" name="original" stroke="#22d3ee" strokeWidth={1} dot={false} isAnimationActive={false} />
        <Line type="stepAfter" dataKey="quant" name="quantized" stroke="#fbbf24" strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}