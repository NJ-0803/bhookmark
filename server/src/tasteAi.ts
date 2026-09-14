// Optional AI step for the taste game: a free-tier Groq model picks which
// untried places to suggest. It can only choose from candidates the server
// supplies (real catalog places with real community data), every pick is
// validated against that list, and any failure — no key, rate limit,
// timeout, bad JSON — returns null so the caller uses the no-AI ranking.
// It never produces or changes a score.

export const TASTE_AI_MODEL = "llama-3.1-8b-instant";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 4000;

export interface TasteCandidate {
  id: string;
  venue: string;
  area: string;
  communityAverage: number | null;
  logCount: number;
}

export interface TastePick {
  id: string;
  reason: string;
}

const SYSTEM_PROMPT = [
  "You suggest restaurants for one person.",
  "You get their own ranking of places they have eaten at (from head-to-head answers they gave) and candidate places they have not tried, with real community data.",
  "Choose up to 3 candidates they are most likely to enjoy.",
  "Rules: only pick ids from the candidates list; ground each reason only in the data given (their ranking, community averages, log counts, areas); never invent dishes, ratings, prices or facts; keep each reason under 18 words.",
  'Reply only with JSON: {"picks": [{"id": "...", "reason": "..."}]}',
].join(" ");

export async function pickWithGroq(
  input: { category: string; ranking: { venue: string; strength: number }[]; candidates: TasteCandidate[] },
  opts: { apiKey?: string; timeoutMs?: number } = {}
): Promise<TastePick[] | null> {
  const apiKey = "apiKey" in opts ? opts.apiKey : process.env.GROQ_API_KEY;
  if (!apiKey || input.candidates.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TASTE_AI_MODEL,
        temperature: 0.2,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;
    const parsed = JSON.parse(text) as { picks?: unknown };
    const validIds = new Set(input.candidates.map((c) => c.id));
    const picks: TastePick[] = [];
    for (const raw of Array.isArray(parsed.picks) ? parsed.picks : []) {
      const pick = raw as { id?: unknown; reason?: unknown };
      if (typeof pick.id !== "string" || !validIds.has(pick.id) || typeof pick.reason !== "string") continue;
      if (picks.some((p) => p.id === pick.id)) continue;
      const reason = pick.reason.trim().slice(0, 160);
      if (!reason) continue;
      picks.push({ id: pick.id, reason });
      if (picks.length === 3) break;
    }
    return picks.length > 0 ? picks : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
