import type { Verdict } from "./types";

export const VERDICT_COPY: Record<Verdict, { label: string; tone: "accent" | "neutral" | "bad" }> = {
  loved: { label: "Obsessed", tone: "accent" },
  fine: { label: "Mid", tone: "neutral" },
  "not-for-me": { label: "Never again", tone: "bad" },
};
