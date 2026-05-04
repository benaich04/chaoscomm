import { useState } from "react";

/**
 * LearnerCard — collapsible plain-English explainer.
 *
 * The first layer of the three-layer pedagogy:
 *    1. LearnerCard   (this)    — what is it, why do we care?
 *    2. Math display  (next)    — formal definition, equations
 *    3. Reference                — research citation
 *
 * Designed to be inviting rather than intimidating: starts EXPANDED by
 * default on the first time a concept appears, has a friendly "First-time
 * here?" subtitle, and uses a different visual treatment than the formal
 * panels around it (cyan accent bar, slightly warmer text).
 */
export default function LearnerCard({
  title = "What's this about?",
  children,
  defaultOpen = true,
  icon = "💡",
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={[
        "rounded-lg border-l-4 border-cyan/60 bg-cyan/[0.03]",
        "border-y border-r border-bg-line",
        "transition-all",
      ].join(" ")}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-cyan/[0.05] rounded-lg transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-base">{icon}</span>
          <div>
            <div className="text-sm font-semibold text-cyan">{title}</div>
            <div className="text-[10px] uppercase tracking-widest text-ink-dim">
              First-time here? Read this.
            </div>
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm leading-relaxed text-ink/90">
          {children}
        </div>
      )}
    </div>
  );
}