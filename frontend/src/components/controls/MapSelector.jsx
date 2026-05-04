/**
 * MapSelector — grouped dropdown listing all 11 built-in maps + custom.
 *
 * Pulls metadata from props.registry (the cached payload of GET /api/maps/registry).
 * Groups by `tier` so the user sees structure: textbook foundations, then
 * research-backed maps, then engineered (LSS/TLC), then 2D, then custom.
 *
 * Renders as a native <select> for keyboard accessibility, but styled to
 * match the dark theme.
 */

const TIER_GROUPS = [
  { tier: "tier1_textbook",  label: "Textbook Foundations" },
  { tier: "tier2_research",  label: "Research-Backed (1D)" },
  { tier: "tier2_engineered", label: "Engineered Maps (Zhou et al. 2014)" },
];

export default function MapSelector({ registry, value, onChange }) {
  if (!registry) {
    return (
      <div className="text-xs text-ink-muted animate-pulse-soft">
        Loading map registry…
      </div>
    );
  }

  const groups = TIER_GROUPS.map(g => ({
    ...g,
    items: Object.values(registry.maps).filter(m => m.tier === g.tier),
  })).filter(g => g.items.length > 0);

  // 2D and custom get their own labels for clarity
  const dim2 = Object.values(registry.maps).filter(m => m.dimension === 2 && m.tier !== "tier1_textbook" && m.tier !== "tier2_engineered");
  const customMeta = registry.custom;

  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-ink-dim mb-1.5">
        Chaotic Map
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          "w-full rounded-md px-3 py-2",
          "bg-bg-base border border-bg-line text-ink",
          "font-medium text-sm",
          "focus:outline-none focus:border-cyan/60 focus:ring-1 focus:ring-cyan/30",
          "appearance-none cursor-pointer",
        ].join(" ")}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path fill='%2394a3b8' d='M6 8L0 0h12z'/></svg>\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 12px center",
          paddingRight: "32px",
        }}
      >
        {groups.map(g => (
          <optgroup key={g.tier} label={g.label}>
            {g.items
              // 1D items go in normal groups; 2D items handled separately
              .filter(m => m.dimension === 1)
              .map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
          </optgroup>
        ))}
        {dim2.length > 0 && (
          <optgroup label="2D Maps">
            {dim2.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </optgroup>
        )}
        <optgroup label="Custom">
          <option value="custom">Custom — type your own f(x, r)</option>
        </optgroup>
      </select>
    </div>
  );
}