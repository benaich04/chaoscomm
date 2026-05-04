import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Area,
} from "recharts";

/**
 * PDFOverlayChart — overlay of estimated and analytical PDFs.
 *
 * Shows:
 *   - Filled area: KDE estimate (cyan, translucent)
 *   - Dashed line:  known analytical PDF (amber, when available)
 *   - Dotted line:  parametric fit (phosphor)
 *
 * This is the visual that answers "what does the invariant measure
 * look like?" for each map — and directly motivates why Lloyd-Max
 * needs the PDF: the optimal quantizer boundaries are placed where
 * density is highest.
 */

export default function PDFOverlayChart({ pdfData, domain = [0, 1], height = 240 }) {
  if (!pdfData?.kde) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-xs text-ink-dim">
        No PDF data yet
      </div>
    );
  }

  const kde = pdfData.kde;
  const known = pdfData.known_analytical;
  const para = pdfData.parametric;

  // Merge all curves into one data array
  const n = kde.x.length;
  const data = [];
  for (let i = 0; i < n; i++) {
    const row = { x: kde.x[i], kde: kde.density[i] };
    if (known?.x?.length === n) row.known = known.density[i];
    if (para?.x?.length === n) row.parametric = para.density[i];
    data.push(row);
  }

  // Y-axis: cap at a sensible maximum (arcsine peaks can be very tall)
  const maxY = Math.min(
    Math.max(...data.map(d => Math.max(d.kde || 0, d.known || 0, d.parametric || 0))),
    20
  );

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
          <XAxis
            dataKey="x" type="number" domain={domain}
            stroke="#94a3b8"
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickFormatter={(v) => Number(v).toFixed(2)}
            label={{ value: "x", position: "insideBottomRight", offset: -2, fill: "#94a3b8", fontSize: 10 }}
          />
          <YAxis
            domain={[0, maxY * 1.1]}
            stroke="#94a3b8"
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            label={{ value: "p(x)", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#141b2d", border: "1px solid #2a3454", borderRadius: "6px", fontSize: "12px" }}
            labelStyle={{ color: "#94a3b8" }}
            labelFormatter={(v) => `x = ${Number(v).toFixed(3)}`}
            formatter={(v, name) => [Number(v).toFixed(4), name]}
          />
          <Legend wrapperStyle={{ fontSize: "11px" }} />

          {/* KDE as filled area */}
          <Area
            type="monotone" dataKey="kde" name="KDE estimate"
            fill="#22d3ee" fillOpacity={0.15} stroke="#22d3ee" strokeWidth={1.5}
            dot={false} isAnimationActive={false}
          />

          {/* Known analytical (when available) */}
          {known && (
            <Line
              type="monotone" dataKey="known" name={known.name || "Analytical"}
              stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="6 3"
              dot={false} isAnimationActive={false}
            />
          )}

          {/* Parametric fit */}
          {para && (
            <Line
              type="monotone" dataKey="parametric" name={`Fit (${para.family})`}
              stroke="#10b981" strokeWidth={1} strokeDasharray="3 3"
              dot={false} isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {/* Known PDF info bar */}
      {known && (
        <div className="mt-2 text-xs text-ink-muted px-1">
          Analytical: <span className="text-amber font-mono">{known.name}</span>
          {known.learner && (
            <span className="ml-2 text-ink-dim">— {known.learner}</span>
          )}
        </div>
      )}
    </div>
  );
}