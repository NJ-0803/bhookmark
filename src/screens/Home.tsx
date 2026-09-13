import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";
import { DISHES, categoryVisual, dishById } from "../data/dishes";
import type { Category, DishEntry } from "../types";
import Medallion from "../components/Medallion";
import BrowseCard from "../components/BrowseCard";
import TrendingStack, { type StackCard } from "../components/TrendingStack";
import DishPanel from "../components/DishPanel";
import { FloatCard, FloatMedia } from "../components/CardStage";
import {
  browseDishes,
  getDietProfile,
  getDigest,
  getNextPicks,
  getTrending,
  getVenueCategories,
  searchVenues,
  type BrowseDish,
  type TrendingResponse,
  type VenueSearchResult,
} from "../api";
import { computeSmartOrder, type SmartOrderResult } from "../smartPicks";
import NearMe from "./NearMe";

const SMART_ORDER_CACHE_KEY = "bhookmark.smartOrder";
const SMART_ORDER_DISMISSED_KEY = "bhookmark.smartOrderDismissed";
const SMART_ORDER_MAX_AGE_MS = 3 * 60 * 60 * 1000; // weather goes stale fast

interface Pick {
  id: string;
  category: string;
  subtype: string;
  name: string;
  venue: string;
  area: string;
  reason: string;
  // Phase 2 Session E: no `score` field at all — a pick with no real
  // evidence yet must never carry a number a client could render as if
  // it were one. Real evidence (when it exists) is fetched separately
  // via GET /dishes/score, same as every other card on this screen.
  hasEvidence: boolean;
}

interface DigestData {
  daysSinceLastLog: number | null;
  logsThisWeek: number;
  topCategoryThisWeek: string | null;
  personalBestThisWeek: { name: string; venue: string; score: number } | null;
}

type View =
  | { name: "search" }
  // 2026-09-13: dropped the "subtype" sub-step for the real DB-backed
  // catalog — almost every real (mostly OSM) dish has subtype "General"
  // (OSM gives a cuisine/category, never a specific menu item), so a
  // subtype picker would show one meaningless option for nearly every
  // category. Category -> real results directly, matching how Near Me
  // already works.
  | { name: "results"; category: string }
  | { name: "nearby" };

export default function Home({ onLogDish }: { onLogDish: (dish: DishEntry) => void }) {
  const [view, setView] = useState<View>({ name: "search" });
  const [query, setQuery] = useState("");
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [userAllergens, setUserAllergens] = useState<string[]>([]);
  const [resultIndex, setResultIndex] = useState(0);
  const [smartOrder, setSmartOrder] = useState<SmartOrderResult | null>(null);
  const [trending, setTrending] = useState<TrendingResponse["trending"] | null>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartDismissed, setSmartDismissed] = useState(() => localStorage.getItem(SMART_ORDER_DISMISSED_KEY) === "1");
  // Real categories, fetched — not hardcoded — so this can never drift
  // from the category_aliases table the way the old "Filter Coffee"
  // array once did (see NearMe.tsx's identical fetch for the same reason).
  const [realCategories, setRealCategories] = useState<string[]>([]);
  // null = not searched yet, [] = searched, no real venues found.
  const [nameSearchResults, setNameSearchResults] = useState<VenueSearchResult[] | null>(null);
  // null = loading, [] = resolved but empty.
  const [browseResults, setBrowseResults] = useState<BrowseDish[] | null>(null);

  const resultsKey = view.name === "results" ? view.category : null;
  useEffect(() => {
    setResultIndex(0);
  }, [resultsKey]);

  useEffect(() => {
    getVenueCategories().then((res) => res.ok && setRealCategories(res.categories));
  }, []);

  // Real venues/dishes for whichever category the user picked — no
  // location required (unlike Near Me), the actual fix for Home's Crave
  // tab still browsing the old ~36-dish static array while Near Me had
  // already moved to the real ~4,900-venue catalog.
  useEffect(() => {
    if (view.name !== "results") {
      setBrowseResults(null);
      return;
    }
    let cancelled = false;
    setBrowseResults(null);
    browseDishes(view.category).then((res) => {
      if (!cancelled) setBrowseResults(res.ok ? res.results : []);
    });
    return () => {
      cancelled = true;
    };
  }, [view]);

  // Real venue/dish name search as the user types — the same fix Near Me
  // already got: a real place is findable by name whether or not it has
  // a resolved category. Debounced so every keystroke doesn't fire a
  // request.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setNameSearchResults(null);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(() => {
      searchVenues(q).then((res) => {
        if (!cancelled) setNameSearchResults(res.ok ? res.results : []);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  useEffect(() => {
    getNextPicks().then((res) => res.ok && setPicks(res.picks)).catch(() => setPicks([]));
    getDigest().then((res) => res.ok && setDigest(res.digest)).catch(() => setDigest(null));
    getDietProfile().then((res) => res.ok && setUserAllergens(res.allergens)).catch(() => setUserAllergens([]));
    getTrending().then((res) => setTrending(res.ok ? res.trending : null)).catch(() => setTrending(null));

    // Reuse a recent result instead of re-prompting geolocation every visit
    // — but never silently request permission on load (only the explicit
    // "Personalize" tap below does that, per the privacy invariant: ask at
    // the point of use, explain the benefit).
    try {
      const cached = JSON.parse(localStorage.getItem(SMART_ORDER_CACHE_KEY) ?? "null");
      if (cached && Date.now() - cached.at < SMART_ORDER_MAX_AGE_MS) {
        setSmartOrder({ categories: cached.categories, reasons: cached.reasons, area: cached.area ?? null, weatherMood: cached.weatherMood ?? null });
      }
    } catch {
      // ignore malformed cache
    }
  }, []);

  function enableSmartPicks() {
    if (!navigator.geolocation) return;
    setSmartLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const result = await computeSmartOrder(pos.coords.latitude, pos.coords.longitude);
        setSmartOrder(result);
        setSmartLoading(false);
        if (result) {
          localStorage.setItem(SMART_ORDER_CACHE_KEY, JSON.stringify({ ...result, at: Date.now() }));
        }
      },
      () => setSmartLoading(false),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }

  function dismissSmartPicks() {
    setSmartDismissed(true);
    localStorage.setItem(SMART_ORDER_DISMISSED_KEY, "1");
  }

  // Real categories (fetched from GET /venues/categories), reordered by
  // smartOrder's weather/location priority where it knows a category —
  // smartOrder's own list (src/smartPicks.ts) predates the 6 new Session
  // B/D categories (Bars & Pubs, Street Food & Chaat, etc.), so anything
  // it doesn't recognize is appended after the ones it does, rather than
  // silently dropped.
  const orderedCategories = useMemo(() => {
    if (!smartOrder) return realCategories;
    const known: string[] = smartOrder.categories.filter((name) => realCategories.includes(name));
    const rest = realCategories.filter((name) => !known.includes(name));
    return [...known, ...rest];
  }, [smartOrder, realCategories]);

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return orderedCategories;
    return orderedCategories.filter((name) => name.toLowerCase().includes(q));
  }, [query, orderedCategories]);

  // Seed scores aren't real ratings, so the fallback never sorts by them —
  // it rotates daily through the photographed catalog dishes, leading with
  // the smart-order category when there is one.
  const rotatedSpotlights = useMemo(() => {
    const withPhotos = DISHES.filter((d) => d.photo);
    const offset = Math.floor(Date.now() / 86_400_000) % withPhotos.length;
    const rotated = [...withPhotos.slice(offset), ...withPhotos.slice(0, offset)];
    const top = smartOrder?.categories[0];
    return top ? [...rotated.filter((d) => d.category === top), ...rotated.filter((d) => d.category !== top)] : rotated;
  }, [smartOrder]);

  // The real trending dish (brief 1.6: an urgency label needs a real
  // recent-time-window calculation behind it) — matched against the static
  // catalog for a photo where possible, falling back to a category visual.
  const trendingSpotlight = useMemo(() => {
    if (!trending) return null;
    const catalogMatch = DISHES.find(
      (d) => d.venue === trending.venue && d.category === trending.category && d.subtype === trending.subtype && d.name === trending.name
    );
    if (catalogMatch) return catalogMatch;
    const visual = categoryVisual(trending.category);
    return {
      id: `trending-${trending.venue}-${trending.name}`,
      category: trending.category as Category,
      subtype: trending.subtype,
      name: trending.name,
      venue: trending.venue,
      area: "Bangalore",
      emoji: visual.emoji,
      tint: visual.tint,
      score: 0,
      verifiedPct: 0,
      logCount: trending.count,
      priceRs: 0,
      tasteNotes: [],
      allergens: [],
      photo: visual.photo,
    } satisfies DishEntry;
  }, [trending]);

  // Phase 2 Session E: a recommended pick's id is now a real dish id from
  // the DB catalog (thousands of rows, mostly Session B's OSM ingestion),
  // not one of the 12 ids the old static DISHES array knew about —
  // dishById(p.id) would silently return undefined for almost every real
  // pick now. Checks the static catalog first (still works for the
  // handful of legacy dishes that happen to match), falling back to a
  // synthetic DishEntry built from the pick's own real fields — same
  // pattern already used above for trendingSpotlight's non-catalog case.
  function toDishEntry(p: { id: string; category: string; subtype: string; name: string; venue: string; area: string; photo?: string | null }): DishEntry {
    const catalogMatch = dishById(p.id);
    if (catalogMatch) return catalogMatch;
    const visual = categoryVisual(p.category);
    return {
      id: p.id,
      category: p.category as Category,
      subtype: p.subtype,
      name: p.name,
      venue: p.venue,
      area: p.area,
      emoji: visual.emoji,
      tint: visual.tint,
      score: 0,
      verifiedPct: 0,
      logCount: 0,
      priceRs: 0,
      tasteNotes: [],
      allergens: [],
      photo: p.photo ?? visual.photo,
    } satisfies DishEntry;
  }

  // Name-search results are venues, not dishes — a venue can have no
  // resolved category yet (Session B inserts every real, named venue
  // unconditionally; ~2,700 have no category), so there's no dish name or
  // subtype either. Falls back to the venue's own name as the "dish" and
  // "General" as the subtype so the profile view has something to render
  // and getDishScore still has a lookup key — an honest "no logs yet" for
  // an uncategorized venue is the correct result, not a bug.
  function venueToDishEntry(v: VenueSearchResult): DishEntry {
    const category = v.category ?? "Uncategorized";
    const visual = categoryVisual(category);
    return {
      id: v.id,
      category: category as Category,
      subtype: v.subtype ?? "General",
      name: v.dishName ?? v.name,
      venue: v.name,
      area: v.area,
      emoji: visual.emoji,
      tint: visual.tint,
      score: 0,
      verifiedPct: 0,
      logCount: 0,
      priceRs: 0,
      tasteNotes: [],
      allergens: [],
      photo: v.photo ?? visual.photo,
    } satisfies DishEntry;
  }

  // The recommended row already shows the server's picks, so the stack only
  // carries the real trending dish plus rotating catalog dishes — matched on
  // name + venue, since pick ids and static catalog ids never coincide.
  const stackCards = useMemo<StackCard[]>(() => {
    const shown = new Set((picks ?? []).map((p) => `${p.name}|${p.venue}`));
    const cards: StackCard[] = [];
    if (trendingSpotlight) {
      cards.push({ dish: trendingSpotlight, badge: `Trending · ${trending?.count ?? 0} this week` });
      shown.add(`${trendingSpotlight.name}|${trendingSpotlight.venue}`);
    }
    for (const dish of rotatedSpotlights) {
      if (cards.length >= 3) break;
      const key = `${dish.name}|${dish.venue}`;
      if (shown.has(key)) continue;
      shown.add(key);
      cards.push({ dish, badge: dish.category });
    }
    return cards;
  }, [trendingSpotlight, trending, picks, rotatedSpotlights]);

  if (view.name === "nearby") {
    return <NearMe onBack={() => setView({ name: "search" })} />;
  }

  if (view.name === "search") {
    return (
      <motion.div key="search" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={LIQUID_SPRING} className="relative px-5 pt-8 pb-32">
        <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-faint mb-3">
          {smartOrder?.area ?? "Bangalore"} · Today
        </p>
        <h1 className="font-display font-semibold text-[26px] leading-[1.15] tracking-[-0.02em] text-ink mb-1.5">
          What are you <span className="text-blood-outline">Bhookmark</span>ing now?
        </h1>
        <p className="text-muted text-[13px] mb-6">Pick a craving. We'll do the rest.</p>

        <div className="flex gap-3.5 overflow-x-auto mb-6 -mx-5 px-5 pb-1" style={{ scrollbarWidth: "none" }}>
          {orderedCategories.map((name) => (
            <motion.button
              key={name}
              whileTap={TAP_SCALE}
              transition={LIQUID_SPRING}
              onClick={() => setView({ name: "results", category: name })}
              className="shrink-0 flex flex-col items-center gap-2 w-[64px]"
            >
              <Medallion seed={name} label={name} className="w-[58px] h-[58px]" />
              <span className="text-[10.5px] text-muted truncate w-full text-center">{name}</span>
            </motion.button>
          ))}
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a craving — burger, dosa, biryani…"
          aria-label="Search a craving"
          className="w-full bg-surface border border-line rounded-xl px-4 py-3.5 text-[15px] placeholder:text-faint outline-none focus:border-accent transition-colors mb-4"
        />

        <button
          onClick={() => setView({ name: "nearby" })}
          className="w-full flex items-center gap-3.5 bg-surface border border-line rounded-xl px-4 py-3.5 mb-3 text-left"
        >
          <PinGlyph />
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-medium text-ink">Restaurants near you</div>
            <div className="text-faint text-[12px] mt-0.5">Share your location once, see what's actually close</div>
          </div>
          <span className="text-faint">›</span>
        </button>

        {smartOrder ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mb-6 px-1">
            {smartOrder.reasons.map((r, i) => (
              <span key={i} className="text-faint text-[11px]">{r}</span>
            ))}
          </div>
        ) : (
          !smartDismissed && (
            <div className="flex items-center gap-3 border border-line rounded-xl px-4 py-2.5 mb-6">
              <button onClick={enableSmartPicks} disabled={smartLoading} className="flex-1 min-w-0 text-left">
                <div className="text-[13px] text-ink/90">{smartLoading ? "Checking your location & weather…" : "Personalize by where you are"}</div>
                <div className="text-faint text-[11px] mt-0.5">Location and live weather reorder the cravings. Nothing is stored.</div>
              </button>
              {!smartLoading && (
                <button onClick={dismissSmartPicks} className="text-faint text-xs shrink-0 w-11 h-11 -mr-2 flex items-center justify-center" aria-label="Dismiss">
                  ✕
                </button>
              )}
            </div>
          )
        )}

        {digest && (digest.daysSinceLastLog === null || digest.daysSinceLastLog >= 1) && (
          <div className="border-t border-line pt-4 mb-7">
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint mb-1.5">While you were away</p>
            {digest.logsThisWeek > 0 ? (
              <p className="text-[13px] text-ink/85 leading-relaxed">
                {digest.logsThisWeek} dish{digest.logsThisWeek > 1 ? "es" : ""} logged this week, mostly {digest.topCategoryThisWeek}.
                {digest.personalBestThisWeek && (
                  <> Your best: <span className="text-accent">{digest.personalBestThisWeek.name}</span>, {digest.personalBestThisWeek.score.toFixed(1)}.</>
                )}
              </p>
            ) : (
              <p className="text-[13px] text-ink/85 leading-relaxed">
                {digest.daysSinceLastLog === null
                  ? "Nothing logged yet. Your first bite starts the journal."
                  : `${digest.daysSinceLastLog} day${digest.daysSinceLastLog === 1 ? "" : "s"} since your last log.`}
              </p>
            )}
          </div>
        )}

        {picks === null ? (
          <div className="mb-7">
            <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-3">Recommended for you</p>
            <div className="flex gap-3 overflow-x-auto -mx-5 px-5" style={{ scrollbarWidth: "none" }}>
              {[0, 1].map((i) => (
                <div key={i} className="shrink-0 w-52">
                  <div className="aspect-[16/10] rounded-card bg-surface2 animate-pulse mb-2" />
                  <div className="h-3.5 w-3/4 rounded bg-surface2 animate-pulse mb-1.5" />
                  <div className="h-3 w-1/2 rounded bg-surface2 animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          picks.length > 0 && (
            <div className="mb-7">
              <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-3">Recommended for you</p>
              <div className="flex gap-3 overflow-x-auto -mx-5 px-5 pb-1" style={{ scrollbarWidth: "none" }}>
                {picks.map((p) => {
                  const photo = dishById(p.id)?.photo;
                  const id = `pick-${p.id}`;
                  return (
                    <FloatCard
                      key={p.id}
                      id={id}
                      label={p.name}
                      className="shrink-0 w-52 bg-surface border border-line"
                      panel={() => (
                        <DishPanel dish={toDishEntry(p)} mediaId={`${id}-media`} photo={photo} reason={p.reason} userAllergens={userAllergens} onLog={onLogDish} />
                      )}
                    >
                      <div className="relative">
                        <FloatMedia id={`${id}-media`} photo={photo} seed={p.category} className="aspect-[16/10]" />
                        <span className="absolute top-2 left-2 text-[9px] font-mono uppercase tracking-[0.14em] text-ink/80 bg-black/60 border border-line rounded px-1.5 py-0.5">
                          {p.category}
                        </span>
                      </div>
                      <div className="p-3">
                        <span className="dish-name text-[15px] text-ink">{p.name}</span>
                        <div className="text-faint text-[11px] mt-1.5 truncate">{p.venue}</div>
                        <p className="text-muted text-[11px] leading-snug line-clamp-2 mt-1">{p.reason}</p>
                      </div>
                    </FloatCard>
                  );
                })}
              </div>
            </div>
          )
        )}

        {query.trim() && (
          <>
            {filteredCategories.length > 0 && (
              <>
                <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-3">Categories matching "{query.trim()}"</p>
                <div className="flex gap-2 flex-wrap mb-5">
                  {filteredCategories.map((name) => (
                    <button
                      key={name}
                      onClick={() => setView({ name: "results", category: name })}
                      className="flex items-center bg-surface border border-line rounded-full px-3.5 py-2 text-[13px]"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </>
            )}

            <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-3">Places matching "{query.trim()}"</p>
            {nameSearchResults === null ? (
              <div className="flex flex-col gap-2.5">
                {[0, 1].map((i) => (
                  <div key={i} className="h-[72px] rounded-card bg-surface2 animate-pulse" />
                ))}
              </div>
            ) : nameSearchResults.length === 0 ? (
              <div className="border border-dashed border-line rounded-card px-6 py-10 text-center">
                <h3 className="font-display font-bold text-lg mb-1.5">Nothing matches "{query.trim()}" yet</h3>
                <p className="text-faint text-xs max-w-[32ch] mx-auto">
                  It might be a real place we don't have yet — tap Near Me to search and add it.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {nameSearchResults.map((v) => {
                  const id = `place-${v.id}`;
                  return (
                    <FloatCard
                      key={v.id}
                      id={id}
                      label={v.name}
                      className="bg-surface border border-line"
                      contentClassName="flex items-center gap-3 p-3.5"
                      panel={() => (
                        <DishPanel dish={venueToDishEntry(v)} mediaId={`${id}-media`} photo={v.photo} userAllergens={userAllergens} onLog={onLogDish} />
                      )}
                    >
                      <FloatMedia id={`${id}-media`} photo={v.photo} seed={v.category ?? v.name} className="w-12 h-12 shrink-0" radius={10} compact />
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] text-ink truncate">{v.name}</div>
                        <div className="text-faint text-xs truncate">{v.area}</div>
                      </div>
                      {v.category ? (
                        <span className="text-[10px] font-mono uppercase text-accent bg-accentDim rounded-full px-2 py-1 shrink-0">{v.category}</span>
                      ) : (
                        <span className="text-[10px] font-mono uppercase text-faint bg-surface2 rounded-full px-2 py-1 shrink-0">uncategorized</span>
                      )}
                    </FloatCard>
                  );
                })}
              </div>
            )}
          </>
        )}

        {!query.trim() && stackCards.length > 0 && (
          <div className="mt-8">
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint mb-3">Worth a look</p>
            <TrendingStack
              cards={stackCards}
              renderPanel={(dish, mediaId) => (
                <DishPanel dish={dish} mediaId={mediaId} photo={dish.photo} userAllergens={userAllergens} onLog={onLogDish} />
              )}
            />
          </div>
        )}
      </motion.div>
    );
  }

  if (view.name === "results") {
    const dishes = browseResults ?? [];
    const safeIndex = Math.min(resultIndex, Math.max(dishes.length - 1, 0));
    const current = dishes[safeIndex];
    const canPrev = safeIndex > 0;
    const canNext = safeIndex < dishes.length - 1;
    const visual = categoryVisual(view.category);

    return (
      <motion.div key={`results-${view.category}`} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={LIQUID_SPRING} className="px-5 pt-6 pb-32">
        <BackRow label={view.category} onBack={() => setView({ name: "search" })} />
        <div className="flex items-center justify-between mb-4">
          <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint">
            {browseResults === null
              ? "Loading…"
              : `${dishes.length} ${view.category.toLowerCase()} spot${dishes.length === 1 ? "" : "s"} in Bangalore`}
          </p>
          {dishes.length > 1 && (
            <p className="font-mono text-[11px] text-faint tabular">{safeIndex + 1} / {dishes.length}</p>
          )}
        </div>

        {browseResults === null ? (
          <div className="aspect-[4/3] rounded-card bg-surface2 animate-pulse" />
        ) : dishes.length === 0 ? (
          <div className="border border-dashed border-line rounded-card px-6 py-10 text-center">
            <h3 className="font-display font-bold text-lg mb-1.5">Nothing here yet</h3>
            <p className="text-muted text-sm">Be the first — tap the + below to log one.</p>
          </div>
        ) : (
          <>
            <BrowseCard
              key={current.id}
              cardKey={current.id}
              canNext={canNext}
              canPrev={canPrev}
              onSwipeNext={() => setResultIndex((i) => Math.min(i + 1, dishes.length - 1))}
              onSwipePrev={() => setResultIndex((i) => Math.max(i - 1, 0))}
            >
              <FloatCard
                id={`result-${current.id}`}
                label={current.name}
                className="bg-surface border border-line"
                panel={() => (
                  <DishPanel
                    dish={toDishEntry(current)}
                    mediaId={`result-${current.id}-media`}
                    photo={current.photo ?? visual.photo}
                    userAllergens={userAllergens}
                    onLog={onLogDish}
                  />
                )}
              >
                <FloatMedia id={`result-${current.id}-media`} photo={current.photo ?? visual.photo} seed={view.category} className="aspect-[21/9]" scrim />
                <div className="p-4">
                  <span className="dish-name text-[17px] text-ink">{current.name}</span>
                  <div className="text-faint text-[12px] mt-1.5 truncate">{current.venue} · {current.area}</div>
                </div>
              </FloatCard>
            </BrowseCard>

            {dishes.length > 1 ? (
              <>
                <p className="text-center text-faint text-xs mt-4">Swipe to browse · tap a card for the full profile</p>
                <div className="flex items-center justify-center gap-4 mt-4">
                  <button
                    onClick={() => setResultIndex((i) => Math.max(i - 1, 0))}
                    disabled={!canPrev}
                    aria-label="Previous dish"
                    className="w-11 h-11 rounded-full bg-surface border border-line flex items-center justify-center text-muted disabled:opacity-30"
                  >
                    ‹
                  </button>
                  <div className="flex gap-1.5">
                    {dishes.map((d, i) => (
                      <span key={d.id} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === safeIndex ? "bg-accent" : "bg-surface2"}`} />
                    ))}
                  </div>
                  <button
                    onClick={() => setResultIndex((i) => Math.min(i + 1, dishes.length - 1))}
                    disabled={!canNext}
                    aria-label="Next dish"
                    className="w-11 h-11 rounded-full bg-surface border border-line flex items-center justify-center text-muted disabled:opacity-30"
                  >
                    ›
                  </button>
                </div>
              </>
            ) : (
              <p className="text-center text-faint text-xs mt-4">Tap the card for the full profile</p>
            )}
          </>
        )}
      </motion.div>
    );
  }

  return null;
}

function PinGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}

function BackRow({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <button onClick={onBack} aria-label="Back" className="w-11 h-11 rounded-full bg-surface border border-line flex items-center justify-center text-muted">
        ‹
      </button>
      <h2 className="font-display font-semibold text-lg truncate">{label}</h2>
    </div>
  );
}
