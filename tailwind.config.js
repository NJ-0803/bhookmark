/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0A0C0C",
        surface: "#141918",
        surface2: "#1B211F",
        line: "#242B29",
        ink: "#F2F6F4",
        muted: "#8CA09C",
        faint: "#7B8D89",
        accent: "#2FD6C4",
        accentInk: "#06201D",
        accentDim: "#123330",
        bad: "#FF7A63",
        badDim: "#2E1A16",
        gold: "#E3B25B",
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
      },
    },
  },
  plugins: [],
};
