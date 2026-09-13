/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ~90% flat near-black. Red is dark blood, used on hairlines and
        // small fills; text-accent is lifted in index.css for legibility.
        bg: "#0A0A0A",
        surface: "#101010",
        surface2: "#161616",
        line: "#2A1518",
        ink: "#EDE8E1",
        muted: "#A19A96",
        faint: "#857E7B",
        accent: "#7A1219",
        accentInk: "#F4EEE8",
        accentDim: "#1C0A0C",
        bad: "#C9525A",
        badDim: "#1F0B0D",
        // No gold anywhere, by explicit direction: the old saffron and coral
        // roles resolve to muted blood tones.
        saffron: "#B9616A",
        saffronDim: "#1C0C0E",
        coral: "#9E2A33",
        coralDim: "#1C0A0C",
      },
      fontFamily: {
        display: ['"Inter Tight"', "Inter", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
        serif: ['"Instrument Serif"', "Georgia", "serif"],
        mono: ['"IBM Plex Mono"', "monospace"],
      },
      // Heavy weights read as childish next to the restrained type; cap them.
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
        card: "16px",
      },
      boxShadow: {
        lift: "0 8px 24px -12px rgba(0,0,0,0.7)",
        // Kept as names because screens reference them; coloured glows are gone.
        accentGlow: "0 8px 24px -12px rgba(0,0,0,0.7)",
        saffronGlow: "0 8px 24px -12px rgba(0,0,0,0.7)",
        coralGlow: "0 8px 24px -12px rgba(0,0,0,0.7)",
        float: "0 12px 36px -14px rgba(0,0,0,0.75)",
      },
    },
  },
  plugins: [],
};
