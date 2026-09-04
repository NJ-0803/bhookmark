// Real haptic feedback via the standard Vibration API — not a fabricated
// "feels like haptics" CSS trick. Honest limitation: iOS Safari has never
// implemented navigator.vibrate (Apple's own platform restriction, not
// something fixable from a web app), so this only actually buzzes on
// Android Chrome/Firefox — everywhere else it's a harmless no-op.
type HapticStyle = "light" | "medium" | "success" | "warning";

const PATTERNS: Record<HapticStyle, number | number[]> = {
  light: 8,
  medium: 16,
  success: [12, 40, 12],
  warning: [20, 30, 20, 30, 20],
};

export function haptic(style: HapticStyle = "light") {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  try {
    navigator.vibrate(PATTERNS[style]);
  } catch {
    // Some browsers throw if called outside a user gesture — never let
    // a haptic nicety break the actual interaction it's attached to.
  }
}
