import Anthropic from "@anthropic-ai/sdk";
import type { NextPick, GroupStat } from "./recommend";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function llmConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * The "high level AI model" layer, scoped deliberately narrowly: the model
 * NEVER decides which dish to recommend (recommend.ts already did that from
 * real logged data, grounded in the real catalog — see AI-02 in the product
 * doc: never let a model invent a restaurant/dish). It only rewrites the
 * explanation into a short, natural sentence from the structured facts it's
 * given. If there's no API key, or the call fails for any reason, this
 * always falls back to the deterministic template — a recommendation must
 * never depend on an external vendor being up (AI-10).
 */
export async function craftRecommendationBlurb(
  favorites: GroupStat[],
  avoid: GroupStat[],
  pick: NextPick
): Promise<{ text: string; source: "llm" | "template" }> {
  const anthropic = getClient();
  if (!anthropic) {
    return { text: pick.reason, source: "template" };
  }

  try {
    const facts = {
      favoriteCategories: favorites.map((f) => `${f.category} (${f.subtype}), loved ${f.lovedCount}x, avg ${f.avgScore.toFixed(1)}`),
      avoidedCategories: avoid.map((a) => `${a.category} (${a.subtype}), avg ${a.avgScore.toFixed(1)}`),
      recommendedDish: `${pick.dish.name} at ${pick.dish.venue} (${pick.dish.category} / ${pick.dish.subtype}, city score ${pick.dish.score})`,
    };

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 100,
      system:
        "You write a single short, warm sentence (max 30 words) explaining a food recommendation. " +
        "Use ONLY the facts given — never invent a dish, restaurant, price, or rating not present in the facts. " +
        "Do not use exclamation marks. Output only the sentence, no preamble.",
      messages: [{ role: "user", content: JSON.stringify(facts) }],
    });

    const text = msg.content.find((b) => b.type === "text")?.text?.trim();
    if (!text) return { text: pick.reason, source: "template" };
    return { text, source: "llm" };
  } catch {
    // Vendor down, rate-limited, bad key, network blip — the app still works.
    return { text: pick.reason, source: "template" };
  }
}
