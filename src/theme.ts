// Evening (warm dark, default) and Daylight (warm light). The saved choice is
// applied before first paint by the inline script in index.html; this module
// owns changing it at runtime.

export type ThemePref = "evening" | "daylight" | "system";

const KEY = "bhookmark.theme";
const THEME_COLOR = { evening: "#151412", daylight: "#F3EEE7" };

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "daylight" || v === "system" ? v : "evening";
  } catch {
    return "evening";
  }
}

function resolve(pref: ThemePref): "evening" | "daylight" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "daylight" : "evening";
}

function apply(pref: ThemePref) {
  const theme = resolve(pref);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Private mode: still apply for this visit.
  }
  apply(pref);
}

/** Keeps "Match device" in step with OS changes and syncs the browser
 * chrome colour on load. */
export function initTheme() {
  apply(getThemePref());
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (getThemePref() === "system") apply("system");
  });
}
