import EquationDisplay from "../math/EquationDisplay.jsx";

/**
 * ParameterSlider — labeled slider for one map parameter.
 *
 * Props:
 *   spec  — { name, label (display, may be Greek), min, max, step, default }
 *   value — current numeric value
 *   onChange — (newValue: number) => void  (called on every input event;
 *              parent is responsible for debouncing)
 *
 * The label is rendered via KaTeX so Greek letters (μ, α) render properly.
 */

// Map of bare-letter labels to LaTeX form for nicer rendering.
// (SymPy's label strings are plain text "μ", but KaTeX renders \mu more
// crisply.  This dictionary covers the cases we actually use.)
const LATEX_LABELS = {
  "μ": "\\mu",
  "α": "\\alpha",
  "r": "r",
  "p": "p",
  "n": "n",
  "a": "a",
  "b": "b",
};

function toLatex(label) {
  return LATEX_LABELS[label] || label;
}

export default function ParameterSlider({ spec, value, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-widest text-ink-dim">
            Parameter
          </span>
          <EquationDisplay tex={toLatex(spec.label)} className="text-amber" />
        </div>
        <span className="font-mono text-sm text-amber tabular-nums">
          {Number(value).toFixed(spec.step < 0.01 ? 4 : spec.step < 0.1 ? 3 : 2)}
        </span>
      </div>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={[
          "w-full h-1.5 rounded-full appearance-none cursor-pointer",
          "bg-bg-line",
          "[&::-webkit-slider-thumb]:appearance-none",
          "[&::-webkit-slider-thumb]:w-4",
          "[&::-webkit-slider-thumb]:h-4",
          "[&::-webkit-slider-thumb]:rounded-full",
          "[&::-webkit-slider-thumb]:bg-amber",
          "[&::-webkit-slider-thumb]:shadow-glow",
          "[&::-webkit-slider-thumb]:cursor-grab",
          "[&::-webkit-slider-thumb]:active:cursor-grabbing",
          "[&::-moz-range-thumb]:w-4",
          "[&::-moz-range-thumb]:h-4",
          "[&::-moz-range-thumb]:rounded-full",
          "[&::-moz-range-thumb]:bg-amber",
          "[&::-moz-range-thumb]:border-0",
          "[&::-moz-range-thumb]:cursor-grab",
        ].join(" ")}
      />
      <div className="flex justify-between mt-0.5">
        <span className="caption-mono text-[10px]">{spec.min}</span>
        <span className="caption-mono text-[10px]">{spec.max}</span>
      </div>
    </div>
  );
}