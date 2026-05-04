/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Backgrounds (dark cockpit)
        bg: {
          base: "#0a0e1a",      // deepest, page background
          panel: "#141b2d",     // cards, sidebars
          raised: "#1e2740",    // hover, slightly lifted
          line: "#2a3454",      // borders, dividers
        },
        // Accent palette
        amber: {
          DEFAULT: "#fbbf24",   // cockpit warning, primary CTA
          dim: "#b45309",
          glow: "#fde68a",
        },
        phosphor: {
          DEFAULT: "#10b981",   // "signal locked", OK status
          dim: "#047857",
          glow: "#6ee7b7",
        },
        cyan: {
          DEFAULT: "#22d3ee",   // data, charts, highlights
          dim: "#0e7490",
          glow: "#a5f3fc",
        },
        crimson: {
          DEFAULT: "#ef4444",   // errors, enemy, jamming
          dim: "#991b1b",
        },
        // Text
        ink: {
          DEFAULT: "#e2e8f0",   // primary
          muted: "#94a3b8",     // secondary
          dim: "#64748b",       // tertiary, captions
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(251, 191, 36, 0.15)",
        "glow-cyan": "0 0 24px rgba(34, 211, 238, 0.18)",
        "glow-phosphor": "0 0 20px rgba(16, 185, 129, 0.22)",
        "panel": "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 0 0 1px rgba(42,52,84,0.6)",
      },
      animation: {
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        "scan": "scan 3s linear infinite",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        "scan": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
      },
    },
  },
  plugins: [],
};