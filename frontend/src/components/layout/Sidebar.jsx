import { NavLink } from "react-router-dom";

/**
 * Sidebar — primary navigation.
 *
 * Pages are grouped to mirror the signal-processing pipeline:
 *   1. Foundations (chaos theory)
 *   2. Quantization & signal construction
 *   3. Modulation & detection
 *   4. Channel & performance
 *   5. Radar
 *   6. Analysis dashboards
 *   7. Mission (the finale, deliberately separated)
 *
 * Each group has a small section header. The Overview page sits above
 * everything as the entry point.
 */

const GROUPS = [
  {
    label: null, // Overview has no group header — it's the home
    items: [
      { path: "/", label: "Mission Overview", icon: "◉" },
    ],
  },
  {
    label: "Chaos Foundations",
    items: [
      { path: "/maps",         label: "Chaotic Maps",           icon: "ƒ" },
      { path: "/bifurcation",  label: "Bifurcation",            icon: "⌥" },
      { path: "/phase",        label: "Phase Portraits",        icon: "◐" },
    ],
  },
  {
    label: "Signal Pipeline",
    items: [
      { path: "/quantization", label: "Quantization",           icon: "▦" },
      { path: "/signal",       label: "Waveform Construction",  icon: "∿" },
      { path: "/csk",          label: "CSK / DCSK",             icon: "⇄" },
      { path: "/matched-filter", label: "Matched Filter",       icon: "⊕" },
    ],
  },
  {
    label: "Channel & Performance",
    items: [
      { path: "/channel",      label: "Channel Models",         icon: "≈" },
      { path: "/correlation",  label: "Correlation",            icon: "⊗" },
      { path: "/spectrum",     label: "Spectrum",               icon: "▤" },
      { path: "/ber",          label: "Bit Error Rate",         icon: "%" },
    ],
  },
  {
    label: "Application",
    items: [
      { path: "/radar",        label: "Chaotic Radar",          icon: "◎" },
      { path: "/metrics",      label: "Metrics Dashboard",      icon: "Σ" },
    ],
  },
  {
    label: "Finale",
    items: [
      { path: "/mission",      label: "Phantom Signal",         icon: "★" },
    ],
  },
];

export default function Sidebar() {
  return (
    <aside className="w-64 shrink-0 bg-bg-panel border-r border-bg-line h-full flex flex-col">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-bg-line">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-amber to-cyan flex items-center justify-center font-bold text-bg-base text-sm shadow-glow-cyan">
            C
          </div>
          <div className="leading-tight">
            <div className="font-semibold tracking-wide">ChaosComm</div>
            <div className="caption-mono text-[10px] text-ink-dim">PHANTOM SIGNAL OPS</div>
          </div>
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto py-3">
        {GROUPS.map((group, i) => (
          <div key={i} className="mb-3">
            {group.label && (
              <div className="px-5 pb-1.5 pt-2 text-[10px] uppercase tracking-widest text-ink-dim font-semibold">
                {group.label}
              </div>
            )}
            <ul className="space-y-0.5 px-2">
              {group.items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === "/"}
                    className={({ isActive }) =>
                      [
                        "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                        "hover:bg-bg-raised hover:text-ink",
                        isActive
                          ? "bg-bg-raised text-amber border-l-2 border-amber pl-[10px]"
                          : "text-ink-muted border-l-2 border-transparent",
                      ].join(" ")
                    }
                  >
                    <span className="font-mono text-base w-5 text-center text-cyan/80">
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer credit */}
      <div className="px-5 py-3 border-t border-bg-line text-[10px] text-ink-dim leading-relaxed">
        <div>Mohamed Benaich</div>
        <div className="font-mono">ECE-UY-3404 · S26</div>
      </div>
    </aside>
  );
}