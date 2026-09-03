// Section 1 of the implementation brief: a public score must never be shown
// with fake decimal-precision confidence. This buckets any aggregate score
// into a qualitative band based on real sample size, so the UI can say
// "early" instead of implying 281 logs of certainty from just 2.
export type ConfidenceBand = "insufficient" | "early" | "developing" | "strong";

export function scoreConfidenceBand(count: number, verifiedCount: number): ConfidenceBand {
  if (count === 0) return "insufficient";
  if (count < 5) return "early";
  if (count < 20 || verifiedCount < 3) return "developing";
  return "strong";
}
