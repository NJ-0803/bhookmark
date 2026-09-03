import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function visionConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface DishCandidate {
  category: string;
  subtype: string;
  name: string;
  confidence: number; // 0-100, model-reported — never hard-coded, never inflated
}

export type DetectResult =
  | { ok: true; isFood: true; candidates: DishCandidate[] }
  | { ok: true; isFood: false; reason: string }
  | { ok: false; error: "vision_not_configured" | "vision_response_unparseable" | "vision_unavailable" };

const DETECT_TOOL = {
  name: "detect_dish",
  description: "Report whether a photo shows a real, identifiable dish, and if so, up to 3 honest candidate identifications.",
  input_schema: {
    type: "object" as const,
    properties: {
      isFood: { type: "boolean" as const },
      reason: {
        type: "string" as const,
        description: "Required when isFood is false: why (blank, corrupt, too dark, not food, unrecognizable, etc).",
      },
      candidates: {
        type: "array" as const,
        maxItems: 3,
        items: {
          type: "object" as const,
          properties: {
            category: { type: "string" as const },
            subtype: { type: "string" as const },
            name: { type: "string" as const },
            confidence: { type: "number" as const, description: "0-100. Your genuine confidence — never default to a high number." },
          },
          required: ["category", "subtype", "name", "confidence"],
        },
      },
    },
    required: ["isFood"],
  },
};

/**
 * Real image analysis via Claude's vision input, scoped deliberately narrow
 * per the brief's AI-dish-recognition requirements (section 1.3): the model
 * must be able to say "this isn't food" or "I'm not sure" rather than being
 * forced into a confident guess, and confidence is never hard-coded. The
 * photo is analyzed in-request only — this function never persists it, and
 * neither does any caller (see routes/logs.ts /detect).
 */
export async function detectDish(imageBase64: string, mimeType: "image/jpeg" | "image/png" | "image/webp"): Promise<DetectResult> {
  const anthropic = getClient();
  if (!anthropic) return { ok: false, error: "vision_not_configured" };

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 500,
      system:
        "You identify a dish from a photo for a food-logging app. Respond ONLY via the detect_dish tool. " +
        "If the image is blank, corrupt, too dark, unrelated to food, or you genuinely cannot tell, set isFood " +
        "to false and explain why in reason — never invent a confident guess to fill the field. Confidence must " +
        "reflect genuine uncertainty; do not default to a high number just because the image contains some food.",
      tools: [DETECT_TOOL],
      tool_choice: { type: "tool", name: "detect_dish" },
      messages: [
        {
          role: "user",
          content: [{ type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } }],
        },
      ],
    });

    const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "detect_dish");
    if (!toolUse) return { ok: false, error: "vision_response_unparseable" };

    const input = toolUse.input as { isFood: boolean; reason?: string; candidates?: DishCandidate[] };
    if (!input.isFood) return { ok: true, isFood: false, reason: input.reason ?? "Could not identify this as food." };
    if (!input.candidates || input.candidates.length === 0) {
      return { ok: true, isFood: false, reason: "No confident candidates were returned." };
    }

    return { ok: true, isFood: true, candidates: input.candidates.slice(0, 3) };
  } catch {
    // Vendor down, rate-limited, bad key, network blip — logging must never
    // depend on an external vendor being up (mirrors llm.ts's fallback rule).
    return { ok: false, error: "vision_unavailable" };
  }
}
