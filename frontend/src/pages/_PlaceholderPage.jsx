/**
 * PlaceholderPage — used by every route until its real component is built.
 *
 * Renders a hero with the page title + subtitle, a "Coming soon" badge,
 * and (only on the landing/overview page) a credits block and an
 * outline of the upcoming pipeline. This file is deleted/replaced as
 * each module's real page is constructed.
 */

const PIPELINE_PREVIEW = [
  ["1", "Message",        "Binary encoding"],
  ["2", "Chaotic Map",    "Choose dynamics + parameter"],
  ["3", "Bifurcation",    "Locate a∞, ensure chaos"],
  ["4", "Quantization",   "Lloyd-Max, PDF-matched"],
  ["5", "CSK / DCSK",     "Modulation onto chaos"],
  ["6", "Channel",        "AWGN, fading, multipath"],
  ["7", "Matched Filter", "Maximize SNR"],
  ["8", "Decision",       "Recover bits, measure BER"],
];

export default function PlaceholderPage({ meta }) {
  const isLanding = meta.isLanding;

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">
      {/* Hero */}
      <div className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">
          MODULE STATUS · PENDING BUILD
        </div>
        <div className="flex items-baseline gap-3 mb-2">
          <span className="caption-mono text-cyan/80">[{meta.path}]</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          {meta.title}
        </h1>
        <p className="text-ink-muted">{meta.subtitle}</p>

        <div className="mt-6 flex items-center gap-3">
          <span className="pill bg-amber/10 text-amber border border-amber/30">
            <span className="w-2 h-2 rounded-full bg-amber animate-pulse-soft" />
            Coming soon
          </span>
          <span className="caption-mono">
            This page will be wired up in a later build step.
          </span>
        </div>
      </div>

      {/* Landing-page-only sections */}
      {isLanding && (
        <>
          {/* Project credits block */}
          <div className="panel p-6 mt-6">
            <div className="section-title mb-4">Project Information</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <CreditRow label="Author" value="Mohamed Benaich" />
              <CreditRow label="Course" value="ECE-UY-3404 · Fundamentals of Communication Theory · S26" />
              <CreditRow label="Instructor" value="Prof. Unnikrishna Pillai" />
              <CreditRow label="Teaching Assistant" value="Irene Fu" />
              <CreditRow label="Platform" value="ChaosComm — Phantom Signal Operations" />
              <CreditRow label="Original Contribution" value="CLQ + BCR — Quantization-Aware Chaos Suitability" />
            </div>
          </div>

          {/* Pipeline preview */}
          <div className="panel p-6 mt-6">
            <div className="section-title mb-4">System Pipeline (preview)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {PIPELINE_PREVIEW.map(([n, title, sub]) => (
                <div
                  key={n}
                  className="rounded-md border border-bg-line bg-bg-base/40 p-3 hover:border-cyan/40 transition-colors"
                >
                  <div className="caption-mono text-cyan">STAGE {n}</div>
                  <div className="font-medium mt-1">{title}</div>
                  <div className="text-xs text-ink-muted mt-0.5">{sub}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-dim mt-4 leading-relaxed">
              The full interactive flowchart with live previews and
              clickable nodes will be built in a later step. Each stage
              will surface its governing equation, a mini live preview,
              and a navigation handle to its dedicated module page.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function CreditRow({ label, value }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-widest text-ink-dim">{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </div>
  );
}