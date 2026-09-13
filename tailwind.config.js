/** @type {import('tailwindcss').Config} */

// Semantic tokens resolve to CSS variables (RGB channels) defined per theme
// in src/index.css, so every component follows Evening or Daylight without
// knowing which one is active, and `/<alpha>` modifiers still work.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        surface2: token("surface2"),
        line: token("line"),
        ink: token("ink"),
        muted: token("muted"),
        faint: token("faint"),
        // Burgundy: button fills, rings, active states.
        accent: token("accent"),
        accentInk: token("accent-ink"),
        accentDim: token("accent-dim"),
        // Links, highlights and any accent-coloured text (rose in Evening,
        // burgundy in Daylight) — burgundy itself is too dark for text on
        // the Evening background.
        rose: token("rose"),
        bad: token("bad"),
        badDim: token("bad-dim"),
        // Legacy role names still referenced by screens; they resolve to the
        // same restrained burgundy family, never a separate hue.
        saffron: token("rose"),
        saffronDim: token("accent-dim"),
        coral: token("accent"),
        coralDim: token("accent-dim"),
      },
      fontFamily: {
        display: ['"Inter Tight"', "Inter", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
        serif: ['"Instrument Serif"', "Georgia", "serif"],
        mono: ['"IBM Plex Mono"', "monospace"],
      },
      fontWeight: {
        bold: "600",
        extrabold: "600",
        black: "600",
      },
      fontSize: {
        lg: ["1rem", { lineHeight: "1.4rem" }],
        xl: ["1.125rem", { lineHeight: "1.5rem" }],
        "2xl": ["1.3125rem", { lineHeight: "1.7rem" }],
        "3xl": ["1.5625rem", { lineHeight: "1.9rem" }],
        "4xl": ["1.875rem", { lineHeight: "2.2rem" }],
        "5xl": ["2.375rem", { lineHeight: "1" }],
      },
      borderRadius: {
        card: "22px",
      },
      boxShadow: {
        lift: "var(--shadow-card)",
        accentGlow: "var(--shadow-card)",
        saffronGlow: "var(--shadow-card)",
        coralGlow: "var(--shadow-card)",
        float: "var(--shadow-card)",
      },
    },
  },
  plugins: [],
};
