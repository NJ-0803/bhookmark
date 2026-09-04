/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#070908",
        surface: "#101513",
        surface2: "#171E1B",
        line: "#202826",
        ink: "#F5F1E8",
        muted: "#8CA09C",
        faint: "#7B8D89",
        // Turquoise is now spent on actions only — saffron carries
        // discovery/trending, coral carries social reactions. Previously
        // one accent color did all three jobs.
        accent: "#31E2D1",
        accentInk: "#06201D",
        accentDim: "#123330",
        bad: "#FF7A63",
        badDim: "#2E1A16",
        saffron: "#FFB547",
        saffronDim: "#3A2A12",
        coral: "#FF6659",
        coralDim: "#3A1815",
      },
      fontFamily: {
        display: ["Archivo", "system-ui", "sans-serif"],
        body: ["Hanken Grotesk", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      borderRadius: {
        card: "18px",
      },
      boxShadow: {
        lift: "0 8px 24px -12px rgba(0,0,0,0.6)",
        // Food-colored lift shadows (brief: cards should "cast a
        // food-coloured shadow" instead of a flat black one). Each value
        // bundles the black lift AND the color glow into ONE box-shadow —
        // Tailwind's shadow-* utilities all set the same CSS property, so
        // two separate shadow-* classes on one element can't combine; only
        // one wins. A combined value is the only way to actually get both.
        accentGlow: "0 8px 24px -12px rgba(0,0,0,0.6), 0 12px 28px -10px rgba(49,226,209,0.55)",
        saffronGlow: "0 8px 24px -12px rgba(0,0,0,0.6), 0 12px 28px -10px rgba(255,181,71,0.55)",
        coralGlow: "0 8px 24px -12px rgba(0,0,0,0.6), 0 12px 28px -10px rgba(255,102,89,0.55)",
      },
    },
  },
  plugins: [],
};
