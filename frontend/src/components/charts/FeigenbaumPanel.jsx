import EquationDisplay from "../math/EquationDisplay.jsx";

/**
 * FeigenbaumPanel — shows the detected period-doublings and the ratios
 * that should converge to δ = 4.6692016... universally.
 *
 * The panel has four sections:
 *   1. Headline: estimated δ vs theoretical, with relative error
 *   2. r_n table: detected period-doubling parameters
 *   3. δ ratios: the successive (r_n - r_{n-1})/(r_{n+1} - r_n)
 *   4. a∞ extrapolation: chaos onset, vs theoretical 3.5699 (logistic)
 *
 * If fewer than 3 r_n values were detected (typical for a coarse sweep),
 * we explain politely that more resolution is needed.
 */
export default function FeigenbaumPanel({ data, mapId, busy }) {
  if (!data) {
    return (
      <div className="panel p-5 h-full">
        <div className="section-title mb-2">Feigenbaum analysis</div>
        <div className="text-xs text-ink-dim animate-pulse-soft">
          {busy ? "Computing period-doubling cascade…" : "Run a sweep to compute δ and a∞."}
        </div>
      </div>
    );
  }

  const { rn = [], deltas = [], delta_estimate, delta_theoretical,
          a_infinity_estimate, a_infinity_theoretical_logistic } = data;
  const isLogistic = mapId === "logistic";

  const deltaErr = delta_estimate
    ? Math.abs(delta_estimate - delta_theoretical) / delta_theoretical * 100
    : null;
  const aInfErr = (isLogistic && a_infinity_estimate)
    ? Math.abs(a_infinity_estimate - a_infinity_theoretical_logistic) /
      a_infinity_theoretical_logistic * 100
    : null;

  return (
    <div className="panel p-5 space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="section-title">Feigenbaum analysis</div>
          <div className="caption-mono mt-0.5">
            δ = lim (rₙ - rₙ₋₁) / (rₙ₊₁ - rₙ)
          </div>
        </div>
        {busy && <span className="caption-mono text-cyan animate-pulse-soft">refreshing…</span>}
      </div>

      {/* Headline metric */}
      <div className="rounded-md border border-bg-line bg-bg-base/50 p-4">
        <div className="text-[10px] uppercase tracking-widest text-ink-dim">Estimated δ</div>
        <div className="flex items-baseline gap-3 mt-1">
          <span className="text-3xl font-semibold text-amber tabular-nums">
            {delta_estimate ? delta_estimate.toFixed(4) : "—"}
          </span>
          <span className="caption-mono">
            theoretical: {delta_theoretical.toFixed(4)}
          </span>
        </div>
        {deltaErr != null && (
          <div className="text-[11px] mt-1 text-ink-muted">
            Relative error:{" "}
            <span className={deltaErr < 5 ? "text-phosphor" : deltaErr < 15 ? "text-amber" : "text-crimson"}>
              {deltaErr.toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      {/* a∞ */}
      <div className="rounded-md border border-bg-line bg-bg-base/50 p-4">
        <div className="text-[10px] uppercase tracking-widest text-ink-dim">
          Extrapolated a∞
          <span className="ml-2 normal-case text-ink-dim">(chaos onset)</span>
        </div>
        <div className="flex items-baseline gap-3 mt-1">
          <span className="text-2xl font-semibold text-amber tabular-nums">
            {a_infinity_estimate ? a_infinity_estimate.toFixed(5) : "—"}
          </span>
          {isLogistic && (
            <span className="caption-mono">
              theoretical: {a_infinity_theoretical_logistic.toFixed(5)}
            </span>
          )}
        </div>
        {aInfErr != null && (
          <div className="text-[11px] mt-1 text-ink-muted">
            Relative error:{" "}
            <span className={aInfErr < 1 ? "text-phosphor" : aInfErr < 5 ? "text-amber" : "text-crimson"}>
              {aInfErr.toFixed(3)}%
            </span>
          </div>
        )}
      </div>

      {/* r_n table */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">
          Detected period-doubling values rₙ
        </div>
        {rn.length === 0 ? (
          <div className="text-xs text-ink-muted">
            No doublings detected. Try a finer parameter range or higher resolution.
          </div>
        ) : (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-ink-dim">
                <th className="text-left py-1">n</th>
                <th className="text-left py-1">rₙ</th>
                <th className="text-left py-1">δₙ = (rₙ - rₙ₋₁)/(rₙ₊₁ - rₙ)</th>
              </tr>
            </thead>
            <tbody>
              {rn.map((r, i) => {
                const d = deltas[i - 1];
                return (
                  <tr key={i} className="border-t border-bg-line/50">
                    <td className="py-1 text-ink-muted">{i + 1}</td>
                    <td className="py-1 text-ink">{Number(r).toFixed(4)}</td>
                    <td className={d ? "py-1 text-amber" : "py-1 text-ink-dim"}>
                      {d ? d.toFixed(4) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {data.warning && (
        <div className="text-[11px] text-amber/80 italic border-l-2 border-amber/40 pl-2">
          {data.warning}
        </div>
      )}

      <div className="text-[11px] text-ink-dim leading-relaxed pt-2 border-t border-bg-line">
        Universality: the same δ ≈ 4.6692 appears for every smooth one-hump map.
        {!isLogistic && " (Theoretical a∞ above is logistic-specific; this map's a∞ may differ.)"}
      </div>
    </div>
  );
}