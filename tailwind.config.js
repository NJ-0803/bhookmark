/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#080707",
        surface: "#121010",
        surface2: "#1A1717",
        line: "#262121",
        ink: "#F5F1E8",
        muted: "#A39B9A",
        faint: "#8A8281",
        // "Blood gradient" red-on-black identity (replaces the earlier
        // purple/pink/magenta) — saffron still carries discovery/trending,
        // coral still carries social reactions. accent is the flat
        // representative (text/borders); actual buttons use the
        // .gradient-primary class from index.css for the full gradient.
        accent: "#E1122E",
        accentInk: "#FFFFFF",
        accentDim: "#2A0A0C",
        bad: "#FF7A63",
        badDim: "#2E1A16",
        saffron: "#FFB547",
        saffronDim: "#3A2A12",
        coral: "#FF6659",
        coralDim: "#3A1815",
      },
      fontFamily: {
        // Archivo read as too plain/generic ("boring") — Unbounded is a
        // bold, geometric variable display face built for exactly this kind
        // of vibrant, expressive app; Hanken Grotesk stays for body text,
        // which needs to stay readable rather than characterful.
        display: ["Unbounded", "system-ui", "sans-serif"],
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
        accentGlow: "0 8px 24px -12px rgba(0,0,0,0.6), 0 12px 28px -10px rgba(225,18,46,0.55)",
        saffronGlow: "0 8px 24px -12px rgba(0,0,0,0.6), 0 12px 28px -10px rgba(255,181,71,0.55)",
        coralGlow: "0 8px 24px -12px rgba(0,0,0,0.6), 0 12px 28px -10px rgba(255,102,89,0.55)",
        // Baseline float for every card (brief: "every card should float").
        float: "0 12px 36px -14px rgba(0,0,0,0.65)",
      },
    },
  },
  plugins: [],
};
