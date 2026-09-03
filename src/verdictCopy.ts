import type { Verdict } from "./types";

// A young, funny, a little unhinged emoji vocabulary — internet-vernacular
// rather than corporate-safe, on purpose. Used everywhere a verdict or score
// gets shown so the app has one consistent voice instead of ad-hoc slang.
export const VERDICT_COPY: Record<Verdict, { label: string; emoji: string; swipeLabel: string; tone: "accent" | "neutral" | "bad" }> = {
  loved: { label: "Obsessed", emoji: "🔥", swipeLabel: "YEAH 🔥", tone: "accent" },
  fine: { label: "Mid", emoji: "😐", swipeLabel: "eh, mid", tone: "neutral" },
  "not-for-me": { label: "Never again", emoji: "💀", swipeLabel: "NAH 💀", tone: "bad" },
};

export function scoreEmoji(score: number): string {
  if (score >= 9) return "🔥";
  if (score >= 7.5) return "😋";
  if (score >= 6) return "😐";
  if (score >= 4) return "🤨";
  return "💀";
}
