import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

/**
 * MSEComparisonChart — MSE vs number of quantization levels.
 *
 * Shows one line per method (uniform, μ-law, Lloyd-Max, theoretical),
 * demonstrating that Lloyd-Max ≤ uniform and that both converge
 * toward zero as N grows.
 *
 * Uses log scale on Y axis since MSE drops by ~4× per doubling of N.
 *
 * Props:
 *   data — output of POST /api/quantization/mse-comparison
 */

const METHOD_STYLES = {
  uniform_midrise:       { stroke: "#22d3ee", name: "Uniform", dash: "0" },
  uniform_midtread:      { stroke: "#22d3ee", name: "Midtread", dash: "4 3" },
  mu_law:                { stroke: "#a78bfa", name: "μ-law", dash: "0" },
  a_law:                 { stroke: "#c084fc", name: "A-law", dash: "0" },
  lloyd_max:             { stroke: "#fbbf24", name: "Lloyd-Max", dash: "0" },
  theoretical_uniform:   { stroke: "#10b981", name: "Theory (6.02B+1.76)", dash: "6 3" },
};

export default function MSEComparisonChart({ data, mode = "mse" }) {
  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="h-60 flex items-center justify-center text-xs text-ink-dim">
        No comparison data yet
      </div>
    );
  }

  // Build a merged table: { n_levels, method1_mse, method2_mse, ... }
  const allLevels = new Set();
  for (const [method, curve] of Object.entries(data)) {
    if (!Array.isArray(curve)) continue;
    for (const pt of curve) allLevels.add(pt.n_levels);
  }
  const sortedLevels = [...allLevels].sort((a, b) => a - b);

  const mergedData = sortedLevels.map((n) => {
    const row = { n_levels: n };
    for (const [method, curve] of Object.entries(data)) {
      if (!Array.isArray(curve)) continue;
      const pt = curve.find((p) => p.n_levels === n);
      if (pt) {
        row[`${method}_mse`] = pt.mse;
        row[`${method}_sqnr`] = pt.sqnr_db;
      }
    }
    return row;
  });

  const valueKey = mode === "sqnr" ? "sqnr" : "mse";
  const yLabel = mode === "sqnr" ? "SQNR (dB)" : "MSE";

  // Visible methods (only those present in data)
  const methods = Object.keys(data).filter((m) => Array.isArray(data[m]) && data[m].length > 0);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={mergedData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
        <XAxis
          dataKey="n_levels" stroke="#94a3b8"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          label={{ value: "N (levels)", position: "insideBottomRight", offset: -2, fill: "#94a3b8", fontSize: 10 }}
        />
        <YAxis
          stroke="#94a3b8"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          scale={mode === "mse" ? "log" : "linear"}
          domain={mode === "mse" ? ["auto", "auto"] : undefined}
          label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }}
          tickFormatter={(v) => mode === "mse" ? v.toExponential(1) : v.toFixed(0)}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#141b2d", border: "1px solid #2a3454", borderRadius: "6px", fontSize: "12px" }}
          labelStyle={{ color: "#94a3b8" }}
          labelFormatter={(v) => `N = ${v} levels`}
          formatter={(v, name) => {
            const val = mode === "mse" ? Number(v).toExponential(3) : Number(v).toFixed(1) + " dB";
            return [val, name.replace(/_/g, " ").replace(` ${valueKey}`, "")];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: "11px" }}
          formatter={(value) => value.replace(/_/g, " ").replace(` ${valueKey}`, "")}
        />
        {methods.map((method) => {
          const style = METHOD_STYLES[method] || { stroke: "#64748b", name: method, dash: "0" };
          return (
            <Line
              key={method}
              type="monotone"
              dataKey={`${method}_${valueKey}`}
              name={`${style.name} ${valueKey}`}
              stroke={style.stroke}
              strokeWidth={method === "lloyd_max" ? 2 : 1.3}
              strokeDasharray={style.dash}
              dot={{ r: 2.5 }}
              isAnimationActive={false}
              connectNulls
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}