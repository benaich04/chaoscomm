import { useState } from "react";
import EquationDisplay from "../math/EquationDisplay.jsx";

/**
 * CustomExpressionInput — input box for user-supplied f(x, r).
 *
 * Props:
 *   meta              — registry.custom block (allowed symbols, examples)
 *   value             — currently committed expression
 *   onCommit          — (expr: string) => void; called when user presses
 *                       Apply or hits Enter
 *   serverError       — optional string from a 400 response (e.g. parser
 *                       rejection message)
 *
 * Three-pane layout:
 *   - Top:    quick example chips
 *   - Middle: monospace input + Apply button
 *   - Bottom: allowed-symbols hint
 */
export default function CustomExpressionInput({ meta, value, onCommit, serverError }) {
  const [draft, setDraft] = useState(value || "");

  if (!meta) return null;

  const apply = () => {
    if (!draft.trim()) return;
    onCommit(draft.trim());
  };

  return (
    <div className="space-y-3">
      {/* Example chips */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1.5">
          Try one of these
        </div>
        <div className="flex flex-wrap gap-1.5">
          {meta.examples.map((ex, i) => (
            <button
              key={i}
              onClick={() => setDraft(ex)}
              className={[
                "px-2.5 py-1 rounded font-mono text-xs",
                "bg-bg-base border border-bg-line text-ink-muted",
                "hover:border-cyan/50 hover:text-cyan transition-colors",
              ].join(" ")}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Input + Apply */}
      <div>
        <label className="block text-[10px] uppercase tracking-widest text-ink-dim mb-1.5">
          Your expression — f(x, r) =
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder="e.g.  r*sin(pi*x)"
            spellCheck={false}
            className={[
              "flex-1 rounded-md px-3 py-2 font-mono text-sm",
              "bg-bg-base border text-ink",
              serverError ? "border-crimson/50" : "border-bg-line",
              "focus:outline-none focus:border-cyan/60 focus:ring-1 focus:ring-cyan/30",
            ].join(" ")}
          />
          <button
            onClick={apply}
            disabled={!draft.trim() || draft.trim() === value}
            className={[
              "px-4 py-2 rounded-md font-medium text-sm",
              "bg-amber text-bg-base hover:bg-amber-glow",
              "disabled:bg-bg-line disabled:text-ink-dim disabled:cursor-not-allowed",
              "transition-colors",
            ].join(" ")}
          >
            Apply
          </button>
        </div>
        {serverError && (
          <div className="mt-2 text-xs text-crimson font-mono">{serverError}</div>
        )}
      </div>

      {/* Allowed-symbols hint */}
      <details className="text-xs text-ink-muted">
        <summary className="cursor-pointer hover:text-ink">
          Allowed symbols & functions
        </summary>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 pl-4">
          <div>
            <div className="text-[10px] uppercase text-ink-dim">Variables</div>
            <div className="font-mono">
              {meta.allowed_symbols.join(", ")}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-ink-dim">Functions</div>
            <ul className="font-mono space-y-0.5">
              {meta.allowed_functions.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}