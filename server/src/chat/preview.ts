import { bookmarkSchema, type Bookmark, type BookmarkInput } from "../bookmarks";

/** A proposal only. No text supplied by a user can execute a write here. */
export type Preview =
  | { kind: "clarify"; reply: string; choices?: { id: string; name: string; address: string }[] }
  | { kind: "list"; reply: string; bookmarks: Bookmark[] }
  | { kind: "proposal"; reply: string; operation: "save" | "update"; bookmarkId?: string; input: BookmarkInput };
export interface ChatRestaurant { id: string; name: string; address: string }
export interface PreviewDependencies {
  list: (userId: string) => Promise<Bookmark[]>;
  search: (query: string) => Promise<ChatRestaurant[]>;
}

const HELP = 'Try "Save pizza at Toit Indiranagar", "Had pizza at Toit Indiranagar, 8.5/10", or "Show my saves". This preview never changes your saved food.';
export const normalized = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
const plain = (s: string) => normalized(s).replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
const sameRestaurant = (query: string, r: ChatRestaurant) => {
  const q = plain(query), name = plain(r.name), address = plain(r.address);
  return q === name || q === plain(`${r.name} ${r.address}`)
    || (q.startsWith(`${name} `) && address.includes(q.slice(name.length + 1)));
};

export async function previewMessage(userId: string, message: string, deps: PreviewDependencies): Promise<Preview> {
  const text = message.trim();
  if (/^(show|list)( my)? (saves|saved food|bhookmarks)[.!]?$/i.test(text)) {
    const bookmarks = await deps.list(userId);
    return { kind: "list", reply: bookmarks.length ? `You have ${bookmarks.length} saved dishes.` : "You haven't saved any dishes yet.", bookmarks };
  }
  const recall = /^what (?:dishes )?did i like at (.+?)[?]?$/i.exec(text);
  if (recall) {
    const items = (await deps.list(userId)).filter(b => b.tried && b.rating !== null && sameRestaurant(recall[1], { id: b.restaurantId, name: b.restaurantName, address: b.address }));
    const bookmarks = items.sort((a, b) => b.rating! - a.rating!);
    return { kind: "list", reply: bookmarks.length ? "Your rated dishes, highest rating first:" : "No rated dishes match that restaurant. Try the branch name too.", bookmarks };
  }
  // Deliberately narrow grammar for the first test-mode build. AI is not needed
  // to prove the account/branch/rating integration, and may never infer scores.
  const rated = /^(?:had|ate|rate|i had|i ate) (.+?) at (.+?),\s*([+-]?\d+(?:\.\d+)?)\s*\/\s*10[.!]?$/i.exec(text);
  const save = /^save (.+?) at (.+?)[.!]?$/i.exec(text);
  const eaten = /^(?:had|ate|i had|i ate) (.+?) at (.+?)[.!]?$/i.exec(text);
  const match = rated ?? save ?? eaten;
  if (!match) return { kind: "clarify", reply: HELP };
  const name = match[1].trim(), query = match[2].trim();
  const rating = rated ? Number(rated[3]) : null;
  if (rated && (!Number.isFinite(rating) || rating! < 0 || rating! > 10 || !Number.isInteger(rating! * 2))) {
    return { kind: "clarify", reply: "Choose a rating from 0 to 10 in half-point steps, such as 8 or 8.5. I won't round it for you." };
  }
  if (name.length > 120 || query.length > 120) return { kind: "clarify", reply: "Please use a shorter dish or restaurant name (120 characters each at most)." };
  const existing = await deps.list(userId);
  // Prefer known saved identity, but never collapse two different branch IDs.
  const known = existing.filter(b => sameRestaurant(query, { id: b.restaurantId, name: b.restaurantName, address: b.address }));
  const found = [...known.map(b => ({ id: b.restaurantId, name: b.restaurantName, address: b.address })), ...await deps.search(query)];
  const unique = Array.from(new Map(found.map(r => [r.id, r])).values());
  const exact = unique.filter(r => sameRestaurant(query, r));
  const candidates = exact.length ? exact : unique;
  if (!candidates.length) return { kind: "clarify", reply: "I couldn't find that restaurant. Please include its name and branch or area. Nothing has been saved." };
  if (candidates.length !== 1) return { kind: "clarify", reply: "Which restaurant branch do you mean? Include its branch or area in your message. Nothing has been saved.", choices: candidates.slice(0, 5) };
  const restaurant = candidates[0];
  const old = existing.find(b => b.restaurantId === restaurant.id && normalized(b.name) === normalized(name));
  const input = bookmarkSchema.safeParse({
    restaurantId: restaurant.id, restaurantName: restaurant.name, address: restaurant.address,
    name: old?.name ?? name, note: old?.note ?? "", referenceUrl: old?.referenceUrl ?? "",
    tried: old?.tried === true || Boolean(rated || eaten),
    rating: rated ? rating : old?.rating ?? null,
  });
  if (!input.success) return { kind: "clarify", reply: "Those dish details couldn't be validated. Nothing has been saved." };
  return { kind: "proposal", reply: `Preview only: ${old ? "update" : "save"} ${input.data.name} at ${restaurant.name}${input.data.rating !== null ? `, ${input.data.rating}/10` : ""}. Nothing has been saved.`, operation: old ? "update" : "save", ...(old ? { bookmarkId: old.id } : {}), input: input.data };
}
