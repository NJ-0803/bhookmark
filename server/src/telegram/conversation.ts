import { randomBytes } from "node:crypto";
import { bookmarkSchema, type Bookmark, type BookmarkInput } from "../bookmarks";
import { normalized, parseDishLine, sameRestaurant, type ChatRestaurant } from "../chat/preview";

/**
 * Rules-based, choice-first save conversation for Telegram. No LLM, no network, no database:
 * a pure function of (previous state, input, saved list, restaurant search).
 * Anything it cannot read exactly becomes a choice or a clarifying question. It never guesses a
 * dish, restaurant or rating, and it never writes: it only returns a `save` request after an
 * explicit Confirm, which the execution engine applies under its own locks.
 */
export type Step = "kind" | "dish" | "split" | "city" | "restaurant" | "pick" | "rating" | "review" | "reviewtext" | "target" | "confirm" | "edit";
export interface Draft {
  ate?: boolean; dish?: string; query?: string; city?: "patiala" | "bengaluru"; restaurant?: ChatRestaurant;
  choices?: ChatRestaurant[]; parts?: string[]; rating?: number | null; ratingAsked?: boolean;
  /** Optional private review, stored in the dish note. "keep" leaves any existing note untouched. */
  note?: string; noteMode?: "keep" | "set" | "clear"; reviewAsked?: boolean;
  /** "Rate this" / "Review this" on an already saved dish. */
  targets?: { id: string; name: string; restaurant: ChatRestaurant }[]; intent?: "rate" | "review";
}
export interface ConvState { v: 1; step: Step; draft: Draft; nonce: string; expiresAt: number; history: Step[] }
export interface Button { text: string; data?: string; url?: string }
export interface ConvResult {
  state: ConvState | null; reply: string; buttons?: Button[][];
  save?: { operation: "save" | "update"; bookmarkId?: string; input: BookmarkInput };
  command?: "list";
}
export type ConvInput = { text: string } | { data: string };
export interface ConvDeps { existing: Bookmark[]; search: (query: string, city?: string) => Promise<ChatRestaurant[]>; now: number }
export const CONVERSATION_TTL_MS = 10 * 60_000;
export const MAX_DISHES = 500;
export const BAD_RATING = "Choose a rating from 1 to 10 in half-point steps, such as 8 or 8.5. I won't round it for you.";
const OUT_OF_DATE = "That button is out of date, so I changed nothing. Send MENU to start again.";
const EXPIRED = "That draft expired, so nothing was saved. Send MENU to start again.";

const nonce = () => randomBytes(4).toString("hex");
const callback = /^v1:([a-f0-9]{8}):([a-z0-9.:]{1,12})$/;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const short = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function splitDishes(dish: string): string[] | null {
  const parts = dish.split(/\s*(?:,|;|&|\+|\band\b|\bplus\b)\s*/i).map(p => p.trim()).filter(p => p.length >= 2);
  return parts.length >= 2 && parts.length <= 5 && parts.every(p => p.length <= 120) ? parts : null;
}

function makeState(step: Step, draft: Draft, now: number, history: Step[]): ConvState {
  return { v: 1, step, draft, nonce: nonce(), expiresAt: now + CONVERSATION_TTL_MS, history: history.slice(-8) };
}
const row = (s: ConvState, items: [string, string][]): Button[] => items.map(([text, code]) => ({ text, data: `v1:${s.nonce}:${code}` }));
const navRow = (s: ConvState): Button[] => row(s, [...(s.history.length ? [["Back", "bk"] as [string, string]] : []), ["Cancel", "cx"]]);

function nextStep(d: Draft): Step {
  if (d.ate === undefined) return "kind";
  if (!d.dish) return "dish";
  if (!d.restaurant) return d.city ? "restaurant" : "city";
  if (d.ate && !d.ratingAsked) return "rating";
  if (d.ate && !d.reviewAsked) return "review";
  return "confirm";
}

/** Skip never erases an existing rating (including a legacy 0): only an explicit new score changes it. */
const effectiveRating = (d: Draft, old?: Bookmark): number | null => (typeof d.rating === "number" ? d.rating : old?.rating ?? null);

function summary(d: Draft, existing: Bookmark[]): { text: string; update: boolean } {
  const r = d.restaurant!, old = existing.find(b => b.restaurantId === r.id && normalized(b.name) === normalized(d.dish!));
  const eff = d.ate ? effectiveRating(d, old) : old?.rating ?? null;
  const what = d.ate ? (eff === null ? "ate it, no rating" : `ate it, ${fmt(eff)}/10`) : "save for later";
  const note = d.noteMode === "set" ? `\nPrivate review: "${short(d.note ?? "", 200)}"` : d.noteMode === "clear" ? "\nYour existing review will be cleared." : "";
  const kept = old && old.note && d.noteMode !== "set" && d.noteMode !== "clear" ? " Your existing note and link are kept." : "";
  return { text: `${old ? "Update" : "Save"} ${d.dish} at ${r.name} (${r.address}) - ${what}?${note}${old ? ` You already have this dish.${kept}` : ""}`, update: !!old };
}

/** Prompt for a step. Always issues a fresh nonce so buttons from earlier messages stop working. */
export function render(step: Step, draft: Draft, now: number, history: Step[], deps: Pick<ConvDeps, "existing">, lead = ""): ConvResult {
  const s = makeState(step, draft, now, history);
  const L = lead ? `${lead}\n` : "";
  switch (step) {
    case "kind": return { state: s, reply: `${L}What would you like to do?`, buttons: [row(s, [["Save for later", "kl"], ["Ate it", "ka"]]), row(s, [["Show my saves", "sw"]])] };
    case "dish": return { state: s, reply: `${L}What's the dish? Type its name (up to 120 characters).`, buttons: [navRow(s)] };
    case "split": return { state: s, reply: `${L}That looks like more than one dish. I save one at a time. Which first?${draft.parts!.map((p, i) => `\n${i + 1}. ${p}`).join("")}`,
      buttons: [...draft.parts!.map((p, i) => row(s, [[short(p), `sp${i}`]])), row(s, [["Keep it as one dish name", "spa"]]), navRow(s)] };
    case "city": return { state: s, reply: `${L}Which city is the restaurant in?`, buttons: [row(s, [["Patiala", "cp"], ["Bengaluru", "cb"]]), navRow(s)] };
    case "restaurant": return { state: s, reply: `${L}Which restaurant? Send its name and branch or area.`, buttons: [navRow(s)] };
    case "pick": return { state: s, reply: `${L}Which one do you mean?${draft.choices!.map((c, i) => `\n${i + 1}. ${c.name} - ${c.address}`).join("")}`,
      buttons: [...draft.choices!.map((c, i) => row(s, [[short(`${c.name} - ${c.address}`), `p${i}`]])), row(s, [["None of these", "pn"]]), navRow(s)] };
    case "rating": return { state: s, reply: `${L}How was ${draft.dish}? Tap a score from 1 to 10, or type one (halves are fine, like 8.5).`,
      buttons: [row(s, [1, 2, 3, 4, 5].map(n => [String(n), `r${n}`] as [string, string])), row(s, [6, 7, 8, 9, 10].map(n => [String(n), `r${n}`] as [string, string])), row(s, [["Skip rating", "rs"]]), navRow(s)] };
    case "review": {
      const old = deps.existing.find(b => b.restaurantId === draft.restaurant?.id && normalized(b.name) === normalized(draft.dish ?? ""));
      return old?.note
        ? { state: s, reply: `${L}You already have a private note on this dish: "${short(old.note, 200)}". What should I do with it?`, buttons: [row(s, [["Keep it", "rk"], ["Replace it", "rv"]]), row(s, [["Clear it", "rc"]]), navRow(s)] }
        : { state: s, reply: `${L}Want to add a review? It stays private on your account; nothing is published.`, buttons: [row(s, [["Add review", "rv"], ["Skip", "rk"]]), navRow(s)] };
    }
    case "reviewtext": return { state: s, reply: `${L}Type your review (up to 2000 characters). It stays private on your account.`, buttons: [navRow(s)] };
    case "target": return { state: s, reply: `${L}Which dish do you mean?`, buttons: [...draft.targets!.map((t, i) => row(s, [[short(`${t.name} - ${t.restaurant.name}`), `t${i}`]])), navRow(s)] };
    case "confirm": return { state: s, reply: `${L}${summary(draft, deps.existing).text}`, buttons: [row(s, [["Confirm", "ok"], ["Edit", "ed"], ["Cancel", "cx"]])] };
    case "edit": return { state: s, reply: `${L}What do you want to change?`, buttons: [row(s, [["Dish", "e1"], ["Restaurant", "e2"]]), row(s, [...(draft.ate ? [["Rating", "e3"] as [string, string], ["Review", "e5"] as [string, string]] : []), [draft.ate ? "Switch to save for later" : "Switch to ate it", "e4"]]), row(s, [["Back to summary", "bk"], ["Cancel", "cx"]])] };
  }
}

async function candidates(query: string, city: string | undefined, deps: ConvDeps): Promise<ChatRestaurant[]> {
  const known = deps.existing.filter(b => sameRestaurant(query, { id: b.restaurantId, name: b.restaurantName, address: b.address }))
    .map(b => ({ id: b.restaurantId, name: b.restaurantName, address: b.address }));
  const unique = Array.from(new Map([...known, ...await deps.search(query, city)].map(r => [r.id, r])).values());
  const exact = unique.filter(r => sameRestaurant(query, r));
  return (exact.length ? exact : unique).slice(0, 5);
}

/** Applies a restaurant query to the draft: one match moves on, several become choices, none re-asks. */
async function resolve(draft: Draft, query: string, deps: ConvDeps, history: Step[], from: Step, lead = ""): Promise<ConvResult> {
  if (query.length > 120) return render("restaurant", draft, deps.now, history, deps, "Please use a shorter restaurant name (120 characters at most).");
  if (!draft.city) return render("city", { ...draft, query }, deps.now, [...history, from], deps, lead);
  const found = await candidates(query, draft.city, deps);
  if (!found.length) return render("restaurant", { ...draft, query }, deps.now, history, deps, "I couldn't find that restaurant. Include its name and branch or area. Nothing has been saved.");
  const h = [...history, from];
  if (found.length > 1) return render("pick", { ...draft, query, choices: found }, deps.now, h, deps, lead);
  const next = { ...draft, query, restaurant: found[0], choices: undefined };
  return render(nextStep(next), next, deps.now, h, deps, lead);
}

const menu = (deps: ConvDeps, lead: string) => render("kind", {}, deps.now, [], deps, lead);
const COMMAND = /^\/?(cancel|never ?mind|discard)(@\w+)?[.!]?$/i;
const BACK = /^\/?back(@\w+)?[.!]?$/i;
const MENU = /^\/?(menu|help|start)(@\w+)?[.!]?$/i;
const LIST = /^(show|list)( my)? (saves|saved food|bookmarks)[.!]?$/i;
const RATE_THIS = /^(rate|review)( this| it| that)?( dish)?[.!]?$/i;
const YES = /^(yes|y|ok|okay|confirm|sure)[.!]?$/i;
const NO = /^(no|n|nope|edit|change)[.!]?$/i;

/** One conversation turn. `state` is null when there is no active draft or it expired (callers pass the stored row either way). */
export async function advance(stored: ConvState | null, input: ConvInput, deps: ConvDeps): Promise<ConvResult> {
  const expired = !!stored && stored.expiresAt <= deps.now;
  const st = stored && !expired ? stored : null;

  // Button presses: only valid for the exact current prompt.
  if ("data" in input) {
    const m = callback.exec(input.data);
    if (expired) return { state: null, reply: EXPIRED };
    if (!st || !m || m[1] !== st.nonce) return { state: st, reply: OUT_OF_DATE };
    return handleCode(st, m[2], deps);
  }

  const text = input.text.trim();
  if (LIST.test(text)) return { state: st, reply: "", command: "list" };
  if (COMMAND.test(text)) return { state: null, reply: st ? "Cancelled. Nothing was saved." : "Nothing to cancel." };
  if (MENU.test(text)) return menu(deps, st ? "Starting over. Nothing was saved." : "");
  // A complete one-line message always starts fresh, so "no, I meant ..." corrections work in any step.
  const rate = RATE_THIS.exec(text);
  if (rate) return rateThis(st, rate[1].toLowerCase() === "review" ? "review" : "rate", deps);
  const line = parseDishLine(text);
  if (line) {
    if (line.badRating || line.rating === 0) return { state: st, reply: BAD_RATING };
    return fromLine(line, deps, st ? "Started over with that. Nothing was saved yet." : "");
  }
  if (!st) {
    const lead = expired ? "That draft expired, so nothing was saved. I won't guess what you meant." : "I didn't catch that, and I won't guess. Pick one:";
    return menu(deps, lead);
  }
  if (BACK.test(text)) return back(st, deps);
  return handleText(st, text, deps);
}

async function fromLine(line: NonNullable<ReturnType<typeof parseDishLine>>, deps: ConvDeps, lead: string): Promise<ConvResult> {
  const draft: Draft = { ate: line.ate, dish: line.dish, rating: line.rating, ratingAsked: line.ate && line.rating !== null };
  if (line.dish.length > 120) return render("dish", { ...draft, dish: undefined }, deps.now, [], deps, "Please use a shorter dish name (120 characters at most).");
  const parts = splitDishes(line.dish);
  if (parts) return render("split", { ...draft, query: line.query, parts }, deps.now, [], deps, lead);
  return resolve(draft, line.query, deps, [], "kind", lead);
}

/** "Rate this" / "Review this": use the dish in the current draft, or a dish saved in the last 10 minutes only if it is the only one. Otherwise ask. */
function rateThis(st: ConvState | null, intent: "rate" | "review", deps: ConvDeps): ConvResult {
  const d = st?.draft;
  const fromSaved = (t: { name: string; restaurant: ChatRestaurant }, b?: Bookmark): Draft => ({ ate: true, dish: t.name, restaurant: t.restaurant, query: t.name,
    ratingAsked: intent === "review", rating: intent === "review" ? b?.rating ?? null : undefined, reviewAsked: false });
  if (d?.dish && d.restaurant) {
    const next: Draft = { ...d, ate: true, ratingAsked: intent === "review" ? d.ratingAsked : false, reviewAsked: intent === "review" ? false : d.reviewAsked };
    return render(nextStep(next), next, deps.now, [...(st?.history ?? []), st!.step], deps);
  }
  if (d?.dish) return render(st!.step, d, deps.now, st!.history, deps, "Tell me the restaurant first.");
  const all = deps.existing.map(b => ({ b, id: b.id, name: b.name, restaurant: { id: b.restaurantId, name: b.restaurantName, address: b.address } }));
  if (!all.length) return menu(deps, "You haven't saved any dishes yet. Tell me what you ate:");
  const recent = all.filter(x => deps.now - x.b.savedAt <= CONVERSATION_TTL_MS);
  if (recent.length === 1) { const x = recent[0], dr = fromSaved(x, x.b); return render(nextStep(dr), dr, deps.now, [], deps, `Using ${x.name}, which you just saved.`); }
  const targets = (recent.length > 1 ? recent : all).slice(0, 5).map(x => ({ id: x.id, name: x.name, restaurant: x.restaurant }));
  return render("target", { intent, targets }, deps.now, [], deps, "I won't guess which dish you mean.");
}

function back(st: ConvState, deps: ConvDeps): ConvResult {
  const prev = st.history[st.history.length - 1];
  if (!prev) return render(st.step, st.draft, deps.now, [], deps, "There is nothing earlier to go back to.");
  return render(prev, st.draft, deps.now, st.history.slice(0, -1), deps);
}

async function handleCode(st: ConvState, code: string, deps: ConvDeps): Promise<ConvResult> {
  const d = st.draft, h = st.history, bad = (): ConvResult => ({ state: st, reply: OUT_OF_DATE });
  if (code === "cx") return { state: null, reply: "Cancelled. Nothing was saved." };
  if (code === "bk") return back(st, deps);
  if (code === "sw") return st.step === "kind" ? { state: st, reply: "", command: "list" } : bad();
  const go = (draft: Draft) => render(nextStep(draft), draft, deps.now, [...h, st.step], deps);
  const afterDish = (draft: Draft, lead = ""): Promise<ConvResult> | ConvResult =>
    draft.query ? resolve(draft, draft.query, deps, h, "split", lead) : render(nextStep(draft), draft, deps.now, [...h, "split"], deps, lead);
  switch (st.step) {
    case "kind": if (code === "kl" || code === "ka") return go({ ...d, ate: code === "ka", rating: code === "ka" ? d.rating : null }); return bad();
    case "split": {
      if (code === "spa") return afterDish({ ...d, parts: undefined });
      const i = /^sp(\d)$/.exec(code); if (!i || !d.parts?.[Number(i[1])]) return bad();
      const dish = d.parts[Number(i[1])];
      const note = d.parts.length > 1 ? `Saving "${dish}" first. Send the others one at a time afterwards.` : "";
      return afterDish({ ...d, dish, parts: undefined }, note);
    }
    case "city": {
      if (code !== "cp" && code !== "cb") return bad();
      const nd: Draft = { ...d, city: code === "cp" ? "patiala" : "bengaluru" };
      return nd.query ? resolve(nd, nd.query, deps, h, "city") : go(nd);
    }
    case "pick": {
      if (code === "pn") return render("restaurant", { ...d, choices: undefined }, deps.now, [...h, "pick"], deps, "Okay. Send the restaurant name with its branch or area.");
      const i = /^p(\d)$/.exec(code), pick = i && d.choices?.[Number(i[1])]; if (!pick) return bad();
      return go({ ...d, restaurant: pick, choices: undefined });
    }
    case "rating": {
      if (code === "rs") return go({ ...d, rating: null, ratingAsked: true });
      const r = /^r(\d{1,2})$/.exec(code); if (!r || Number(r[1]) > 10) return bad();
      return go({ ...d, rating: Number(r[1]), ratingAsked: true });
    }
    case "review": {
      if (code === "rk") return go({ ...d, noteMode: "keep", reviewAsked: true });
      if (code === "rc") return go({ ...d, noteMode: "clear", note: undefined, reviewAsked: true });
      if (code === "rv") return render("reviewtext", d, deps.now, [...h, "review"], deps);
      return bad();
    }
    case "target": {
      const i = /^t(\d)$/.exec(code), t = i && d.targets?.[Number(i[1])]; if (!t) return bad();
      const b = deps.existing.find(x => x.id === t.id);
      const dr: Draft = { ate: true, dish: t.name, restaurant: t.restaurant, query: t.name, ratingAsked: d.intent === "review", rating: d.intent === "review" ? b?.rating ?? null : undefined, reviewAsked: false };
      return render(nextStep(dr), dr, deps.now, [...h, "target"], deps);
    }
    case "confirm":
      if (code === "ed") return render("edit", d, deps.now, [...h, "confirm"], deps);
      if (code === "ok") return doSave(d, deps);
      return bad();
    case "edit": {
      const here: Step[] = [...h, "edit"];
      if (code === "e1") return render("dish", { ...d, dish: undefined }, deps.now, here, deps);
      if (code === "e2") return render("restaurant", { ...d, restaurant: undefined, choices: undefined }, deps.now, here, deps);
      if (code === "e3" && d.ate) return render("rating", { ...d, ratingAsked: false }, deps.now, here, deps);
      if (code === "e5" && d.ate) return render("review", { ...d, reviewAsked: false }, deps.now, here, deps);
      if (code === "e4") { const next = { ...d, ate: !d.ate, rating: d.ate ? null : d.rating ?? null, ratingAsked: false }; return render(nextStep(next), next, deps.now, here, deps); }
      return bad();
    }
    default: return bad();
  }
}

async function handleText(st: ConvState, text: string, deps: ConvDeps): Promise<ConvResult> {
  const d = st.draft, h = st.history;
  const reprompt = (lead: string) => render(st.step, d, deps.now, h, deps, lead);
  const go = (draft: Draft) => render(nextStep(draft), draft, deps.now, [...h, st.step], deps);
  switch (st.step) {
    case "kind": {
      if (/^(save( it| this)?( dish)?( for later)?|later|want to try|to try)$/i.test(text)) return go({ ...d, ate: false, rating: null });
      if (/^(ate( it)?|had( it)?|tried( it)?|i (ate|had)( it)?)$/i.test(text)) return go({ ...d, ate: true });
      return reprompt("I can't tell which you mean, so please pick one.");
    }
    case "dish": {
      if (text.length > 120) return reprompt("Please use a shorter dish name (120 characters at most).");
      const parts = splitDishes(text);
      if (parts) return render("split", { ...d, dish: text, parts }, deps.now, [...h, "dish"], deps);
      return go({ ...d, dish: text });
    }
    case "split": return reprompt("Please tap one of the choices.");
    case "city": {
      const c = /^(patiala)$/i.test(text) ? "patiala" : /^(bengaluru|bangalore|banglore|blr)$/i.test(text) ? "bengaluru" : null;
      if (!c) return reprompt("Please tap Patiala or Bengaluru.");
      const nd: Draft = { ...d, city: c };
      return nd.query ? resolve(nd, nd.query, deps, h, "city") : go(nd);
    }
    case "restaurant": return resolve(d, text, deps, h, "restaurant");
    case "pick": {
      const choices = d.choices ?? [];
      const n = /^(\d)$/.exec(text), byName = choices.filter(c => normalized(c.name) === normalized(text));
      const pick = n ? choices[Number(n[1]) - 1] : byName.length === 1 ? byName[0] : undefined;
      if (pick) return go({ ...d, restaurant: pick, choices: undefined });
      if (/^none( of these)?$/i.test(text)) return render("restaurant", { ...d, choices: undefined }, deps.now, [...h, "pick"], deps, "Okay. Send the restaurant name with its branch or area.");
      return reprompt("Tap a choice, or reply with its number.");
    }
    case "rating": {
      if (/^(skip|no rating|none|unrated)$/i.test(text)) return go({ ...d, rating: null, ratingAsked: true });
      const m = /^([+-]?\d+(?:\.\d+)?)\s*(?:\/\s*10)?$/.exec(text);
      if (!m) return reprompt("I need a number from 1 to 10, or Skip.");
      const r = Number(m[1]);
      if (!Number.isFinite(r) || r < 1 || r > 10 || !Number.isInteger(r * 2)) return reprompt(BAD_RATING);
      return go({ ...d, rating: r, ratingAsked: true });
    }
    case "review": return reprompt("Please tap one of the choices.");
    case "reviewtext": {
      if (text.length > 2000) return reprompt("That's too long. Please keep the review under 2000 characters.");
      return render("confirm", { ...d, note: text, noteMode: "set", reviewAsked: true }, deps.now, [...h, "reviewtext"], deps);
    }
    case "target": return reprompt("Please tap one of the choices.");
    case "confirm": {
      if (YES.test(text)) return doSave(d, deps);
      if (NO.test(text)) return render("edit", d, deps.now, [...h, "confirm"], deps);
      return reprompt("Please tap Confirm, Edit or Cancel (or reply YES or EDIT). Nothing is saved yet.");
    }
    case "edit": return reprompt("Please tap one of the choices.");
  }
}

function doSave(d: Draft, deps: ConvDeps): ConvResult {
  if (!d.dish || !d.restaurant || d.ate === undefined) return render(nextStep(d), d, deps.now, [], deps);
  const r = d.restaurant;
  const old = deps.existing.find(b => b.restaurantId === r.id && normalized(b.name) === normalized(d.dish!));
  if (!old && deps.existing.length >= MAX_DISHES) return { state: null, reply: "Your list is full. Nothing saved; remove a dish first." };
  const input = bookmarkSchema.safeParse({
    restaurantId: r.id, restaurantName: r.name, address: r.address, name: old?.name ?? d.dish,
    note: d.noteMode === "set" ? d.note ?? "" : d.noteMode === "clear" ? "" : old?.note ?? "", referenceUrl: old?.referenceUrl ?? "",
    tried: d.ate === true || old?.tried === true,
    rating: d.ate ? effectiveRating(d, old) : old?.rating ?? null,
  });
  if (!input.success) return { state: null, reply: "Those dish details couldn't be validated. Nothing has been saved." };
  return { state: null, reply: "", save: { operation: old ? "update" : "save", ...(old ? { bookmarkId: old.id } : {}), input: input.data } };
}
