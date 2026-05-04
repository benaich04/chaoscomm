// Inline SVG aircraft and enemy silhouettes for the mission system.

export function F22Silhouette({ size = 80, color = "#22d3ee", glow = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: glow ? `drop-shadow(0 0 8px ${color})` : "none" }}>
      <g fill={color} stroke={color} strokeWidth="0.5">
        <path d="M50 10 L52 35 L68 40 L75 45 L75 50 L65 50 L62 60 L66 75 L60 78 L55 70 L52 78 L50 95 L48 78 L45 70 L40 78 L34 75 L38 60 L35 50 L25 50 L25 45 L32 40 L48 35 Z" />
        <path d="M48 35 L40 25 L42 22 L50 33 L58 22 L60 25 L52 35 Z" opacity="0.85" />
      </g>
    </svg>
  );
}

export function F16Silhouette({ size = 80, color = "#fbbf24", glow = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: glow ? `drop-shadow(0 0 8px ${color})` : "none" }}>
      <g fill={color} stroke={color} strokeWidth="0.5">
        <path d="M50 8 L53 28 L55 35 L80 50 L80 55 L60 55 L57 65 L65 78 L60 80 L52 70 L50 92 L48 70 L40 80 L35 78 L43 65 L40 55 L20 55 L20 50 L45 35 L47 28 Z" />
        <circle cx="50" cy="35" r="2.5" fill="#0a0a0a" opacity="0.6" />
      </g>
    </svg>
  );
}

export function C130Silhouette({ size = 80, color = "#10b981", glow = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: glow ? `drop-shadow(0 0 8px ${color})` : "none" }}>
      <g fill={color} stroke={color} strokeWidth="0.5">
        {/* Fuselage */}
        <ellipse cx="50" cy="55" rx="6" ry="38" />
        {/* Main wing */}
        <path d="M10 48 L90 48 L92 52 L85 54 L60 52 L40 52 L15 54 L8 52 Z" />
        {/* Tail wing */}
        <path d="M30 88 L70 88 L72 91 L50 90 L28 91 Z" />
        {/* Vertical stabilizer */}
        <path d="M48 88 L50 78 L52 88 Z" />
        {/* Engines */}
        <ellipse cx="28" cy="50" rx="3" ry="6" />
        <ellipse cx="42" cy="50" rx="3" ry="6" />
        <ellipse cx="58" cy="50" rx="3" ry="6" />
        <ellipse cx="72" cy="50" rx="3" ry="6" />
      </g>
    </svg>
  );
}

export function UAVSilhouette({ size = 80, color = "#a78bfa", glow = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: glow ? `drop-shadow(0 0 8px ${color})` : "none" }}>
      <g fill={color} stroke={color} strokeWidth="0.5">
        <ellipse cx="50" cy="55" rx="3" ry="32" />
        <path d="M5 50 L95 50 L93 54 L60 53 L52 55 L48 55 L40 53 L7 54 Z" />
        <path d="M40 80 L60 80 L62 83 L50 82 L38 83 Z" />
        <path d="M50 80 L48 70 L52 70 Z" />
        <circle cx="50" cy="35" r="3" />
      </g>
    </svg>
  );
}

export function BaseStationSVG({ size = 100, color = "#22d3ee", active = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: `drop-shadow(0 0 12px ${color})` }}>
      <g fill={color} stroke={color} strokeWidth="0.8">
        {/* Tower */}
        <rect x="46" y="50" width="8" height="40" />
        <path d="M40 90 L60 90 L62 95 L38 95 Z" />
        {/* Dish */}
        <ellipse cx="50" cy="35" rx="22" ry="8" fillOpacity="0.2" />
        <path d="M28 35 Q50 20 72 35 L70 38 Q50 25 30 38 Z" />
        {/* Center */}
        <circle cx="50" cy="35" r="3" />
        <line x1="50" y1="35" x2="50" y2="50" strokeWidth="1.5" />
        {/* Signal arcs */}
        {active && [10, 18, 26].map((r, i) => (
          <path key={i} d={`M${50-r},35 A${r},${r*0.6} 0 0,1 ${50+r},35`}
            fill="none" strokeOpacity={0.6 - i*0.15}
            style={{ animation: `pulse 2s ${i*0.4}s ease-out infinite` }} />
        ))}
      </g>
      <style>{`@keyframes pulse { 0%{opacity:0;} 30%{opacity:0.8;} 100%{opacity:0;} }`}</style>
    </svg>
  );
}

export function SIGINTSVG({ size = 80, color = "#ef4444", active = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: `drop-shadow(0 0 8px ${color})` }}>
      <g fill={color} stroke={color} strokeWidth="0.6">
        {/* Dish */}
        <path d="M30 30 Q50 15 70 30 L68 40 Q50 28 32 40 Z" />
        <line x1="50" y1="32" x2="50" y2="60" strokeWidth="2" />
        {/* Tower */}
        <rect x="47" y="60" width="6" height="30" />
        <path d="M40 90 L60 90 L62 95 L38 95 Z" />
        {/* Cross-hairs */}
        <circle cx="50" cy="30" r="3" fill="none" strokeWidth="1" />
        {active && (
          <>
            <line x1="50" y1="22" x2="50" y2="38" strokeOpacity="0.6" />
            <line x1="42" y1="30" x2="58" y2="30" strokeOpacity="0.6" />
          </>
        )}
      </g>
    </svg>
  );
}

export function AWACSSVG({ size = 80, color = "#ef4444" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: `drop-shadow(0 0 8px ${color})` }}>
      <g fill={color} stroke={color} strokeWidth="0.5">
        <ellipse cx="50" cy="55" rx="5" ry="35" />
        <path d="M5 52 L95 52 L93 56 L52 55 L48 55 L7 56 Z" />
        <path d="M30 88 L70 88 L72 91 L28 91 Z" />
        {/* Radome */}
        <ellipse cx="50" cy="40" rx="18" ry="4" />
        <ellipse cx="50" cy="40" rx="18" ry="4" fill="none" strokeWidth="0.8" />
        <line x1="50" y1="40" x2="50" y2="48" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

export function JammerSVG({ size = 80, color = "#ef4444" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: `drop-shadow(0 0 8px ${color})` }}>
      <g fill={color} stroke={color} strokeWidth="0.6">
        <rect x="40" y="60" width="20" height="30" />
        <path d="M35 88 L65 88 L67 95 L33 95 Z" />
        {/* Antenna array */}
        <line x1="50" y1="60" x2="50" y2="20" strokeWidth="1.5" />
        <line x1="40" y1="55" x2="40" y2="30" strokeWidth="1" />
        <line x1="60" y1="55" x2="60" y2="30" strokeWidth="1" />
        {/* Interference */}
        {[0, 1, 2].map(i => (
          <path key={i}
            d={`M${30+i*5} ${15+i*3} Q${50} ${5+i*3} ${70-i*5} ${15+i*3}`}
            fill="none" strokeOpacity={0.5 - i*0.1} strokeDasharray="2 2" />
        ))}
      </g>
    </svg>
  );
}

export const PLATFORM_DATA = {
  F22:  { name: "F-22 Raptor",        role: "Stealth Fighter",   stealthFactor: 0.85, dopplerBase: 0.06, rangeFactor: 0.7, enemyDetMod: -25, color: "#22d3ee", svg: F22Silhouette },
  F16:  { name: "F-16 Falcon",        role: "Tactical Fighter",  stealthFactor: 0.55, dopplerBase: 0.08, rangeFactor: 0.8, enemyDetMod: -10, color: "#fbbf24", svg: F16Silhouette },
  C130: { name: "C-130 Hercules",     role: "Long-Range Relay",  stealthFactor: 0.25, dopplerBase: 0.025, rangeFactor: 1.0, enemyDetMod: +15, color: "#10b981", svg: C130Silhouette },
  UAV:  { name: "MQ-9 Reaper UAV",    role: "Recon Relay",       stealthFactor: 0.60, dopplerBase: 0.04,  rangeFactor: 0.5, enemyDetMod: -5,  color: "#a78bfa", svg: UAVSilhouette },
};

export const ENEMY_DATA = {
  SIGINT:        { name: "Ground SIGINT Station",  threat: 0.5, jammerBase: 0,   color: "#ef4444", svg: SIGINTSVG, desc: "Passive spectrum monitor" },
  AWACS:         { name: "Enemy AWACS",            threat: 0.7, jammerBase: 0,   color: "#ef4444", svg: AWACSSVG,  desc: "Airborne wide-area sensor" },
  JAMMER:        { name: "Wideband Jammer",        threat: 0.6, jammerBase: 0.6, color: "#ef4444", svg: JammerSVG, desc: "Active interference" },
  MULTI_SENSOR:  { name: "Multi-Sensor Net",       threat: 0.95, jammerBase: 0.5, color: "#ef4444", svg: SIGINTSVG, desc: "EXTREME — combined ISR" },
};