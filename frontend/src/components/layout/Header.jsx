import { useEffect } from "react";
import { useStore } from "../../store/useStore.js";

/**
 * Header — top bar.
 *
 * - Left: course / professor / TA credits (your project context)
 * - Right: live backend status pill + MATLAB indicator
 *
 * The pill polls /backend-info every 5s via the store's refreshBackend.
 * If the backend goes down mid-session, the pill turns red; when it
 * recovers, it goes back to green automatically.
 */

const POLL_INTERVAL_MS = 5000;

function StatusPill() {
  const status = useStore((s) => s.backend.status);
  const matlabAvailable = useStore((s) => s.backend.matlabAvailable);
  const activeBackend = useStore((s) => s.backend.activeBackend);

  if (status === "unknown") {
    return (
      <span className="pill bg-bg-raised text-ink-muted">
        <span className="w-2 h-2 rounded-full bg-ink-muted animate-pulse-soft" />
        Connecting…
      </span>
    );
  }
  if (status === "down") {
    return (
      <span className="pill bg-crimson/10 text-crimson border border-crimson/30">
        <span className="w-2 h-2 rounded-full bg-crimson animate-pulse-soft" />
        Backend offline
      </span>
    );
  }
  // status === "ok"
  const matlabLabel = matlabAvailable ? "MATLAB" : "NumPy";
  const color = activeBackend === "matlab" ? "amber" : "cyan";
  const colorClasses =
    color === "amber"
      ? "bg-amber/10 text-amber border-amber/30"
      : "bg-cyan/10 text-cyan border-cyan/30";
  const dotColor = color === "amber" ? "bg-amber" : "bg-cyan";

  return (
    <div className="flex items-center gap-2">
      <span className="pill bg-phosphor/10 text-phosphor border border-phosphor/30">
        <span className="w-2 h-2 rounded-full bg-phosphor shadow-glow-phosphor" />
        Online
      </span>
      <span className={`pill border ${colorClasses}`}>
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        {matlabLabel}
      </span>
    </div>
  );
}

export default function Header() {
  const refreshBackend = useStore((s) => s.refreshBackend);

  // Poll backend on mount + every 5s
  useEffect(() => {
    refreshBackend();
    const id = setInterval(refreshBackend, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshBackend]);

  return (
    <header className="h-16 shrink-0 bg-bg-panel border-b border-bg-line px-6 flex items-center justify-between">
      {/* Course credits */}
      <div className="flex items-center gap-6 text-xs">
        <div className="leading-tight">
          <div className="text-ink-muted uppercase tracking-wider text-[10px]">Course</div>
          <div className="font-mono text-ink">
            ECE-UY-3404 · Fundamentals of Communication Theory · S26
          </div>
        </div>
        <div className="hidden md:block w-px h-8 bg-bg-line" />
        <div className="hidden md:block leading-tight">
          <div className="text-ink-muted uppercase tracking-wider text-[10px]">Instructor / TA</div>
          <div className="font-mono text-ink">
            Prof. Unnikrishna Pillai &nbsp;·&nbsp; Irene Fu
          </div>
        </div>
      </div>

      {/* Backend status */}
      <div className="flex items-center gap-3">
        <StatusPill />
      </div>
    </header>
  );
}