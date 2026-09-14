import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";
import { DISHES, categoryVisual, dishById } from "../data/dishes";
import type { Category, DishEntry } from "../types";
import { CategoryGlyph } from "../components/CategoryArt";
import BrowseCard from "../components/BrowseCard";
import TrendingStack, { type StackCard } from "../components/TrendingStack";
import DishPanel from "../components/DishPanel";
import { CardSaveButton } from "../components/SaveButton";
import { FloatCard, FloatMedia } from "../components/CardStage";
import Reveal from "../components/Reveal";
import { placeLine } from "../format";
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
  // Category -> real results directly: almost every real (mostly OSM) dish
  // has subtype "General", so a subtype picker would show one meaningless
  // option for nearly every category.
  | { name: "search" }
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
  const [smartError, setSmartError] = useState<string | null>(null);
  const [smartDismissed, setSmartDismissed] = useState(() => localStorage.getItem(SMART_ORDER_DISMISSED_KEY) === "1");
  // Real categories, fetched — not hardcoded — so this can never drift
  // from the category_aliases table the way the old "Filter Coffee"
  // array once did (see NearMe.tsx's identical fetch for the same reason).
  const [realCategories, setRealCategories] = useState<string[] | null>(null);
  // null = not searched yet, [] = searched, no real venues found.
  const [nameSearchResults, setNameSearchResults] = useState<VenueSearchResult[] | null>(null);
  // null = loading, [] = resolved but empty.
  const [browseResults, setBrowseResults] = useState<BrowseDish[] | null>(null);

  const resultsKey = view.name === "results" ? view.category : null;
  useEffect(() => {
    setResultIndex(0);
  }, [resultsKey]);

  useEffect(() => {
    getVenueCategories()
      .then((res) => setRealCategories(res.ok ? res.categories : []))
      .catch(() => setRealCategories([]));
  }, []);

  // Real venues/dishes for whichever category the user picked — no
  // location required (unlike Near Me).
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

  // Real venue/dish name search as the user types, debounced — a real place
  // is findable by name whether or not it has a resolved category.
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
    // "Use my location" tap does that: ask at the point of use).
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
    if (!navigator.geolocation) {
      setSmartError("This browser can't share a location.");
      return;
    }
    setSmartLoading(true);
    setSmartError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const result = await computeSmartOrder(pos.coords.latitude, pos.coords.longitude);
          if (result) {
            setSmartOrder(result);
            localStorage.setItem(SMART_ORDER_CACHE_KEY, JSON.stringify({ ...result, at: Date.now() }));
          } else {
            setSmartError("Couldn't read your area right now.");
          }
        } catch {
          setSmartError("Couldn't read your area right now.");
        } finally {
          setSmartLoading(false);
        }
      },
      (err) => {
        setSmartLoading(false);
        setSmartError(err.code === err.PERMISSION_DENIED ? "Location is turned off for Bhookmark." : "Couldn't get your location.");
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }

  function dismissSmartPicks() {
    setSmartDismissed(true);
    localStorage.setItem(SMART_ORDER_DISMISSED_KEY, "1");
  }

  // Real categories reordered by smartOrder's weather/location priority where
  // it knows a category; anything it doesn't recognise keeps its place after.
  const orderedCategories = useMemo(() => {
    const cats = realCategories ?? [];
    if (!smartOrder) return cats;
    const known: string[] = smartOrder.categories.filter((name) => cats.includes(name));
    const rest = cats.filter((name) => !known.includes(name));
    return [...known, ...rest];
  }, [smartOrder, realCategories]);

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return orderedCategories;
    return orderedCategories.filter((name) => name.toLowerCase().includes(q));
  }, [query, orderedCategories]);

  // Seed scores aren't real ratings, so this never sorts by them — it
  // rotates daily through the photographed catalog dishes, leading with the
  // smart-order category when there is one.
  const rotatedSpotlights = useMemo(() => {
    const withPhotos = DISHES.filter((d) => d.photo);
    const offset = Math.floor(Date.now() / 86_400_000) % withPhotos.length;
    const rotated = [...withPhotos.slice(offset), ...withPhotos.slice(0, offset)];
    const top = smartOrder?.categories[0];
    return top ? [...rotated.filter((d) => d.category === top), ...rotated.filter((d) => d.category !== top)] : rotated;
  }, [smartOrder]);

  // The real trending dish, matched against the static catalog for its own
  // photo where possible. No stand-in photo from a different venue.
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
    } satisfies DishEntry;
  }, [trending]);

  // A recommended pick's id is a real DB dish id; the static catalog only
  // matches a handful of legacy ids, so everything else is built from the
  // pick's own real fields.
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
      photo: p.photo ?? undefined,
    } satisfies DishEntry;
  }

  // Name-search results are venues, not dishes, and may have no resolved
  // category yet — the venue's own name stands in as the "dish" and
  // "General" as the subtype so getDishScore still has a lookup key.
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
      photo: v.photo ?? undefined,
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
    return (
      <div className="lg:max-w-[620px] lg:mx-auto">
        <NearMe onBack={() => setView({ name: "search" })} />
      </div>
    );
  }

  if (view.name === "search") {
    const q = query.trim();
    return (
      <motion.div
        key="search"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={LIQUID_SPRING}
        // Mobile: both columns dissolve (display: contents) into one flow
        // ordered intro → first food card → location → the rest, so food is
        // near the top. Desktop: intro + location left, food right.
        className="px-5 lg:px-10 pt-8 lg:pt-12 pb-32 flex flex-col lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12 lg:items-start"
      >
        <div className="contents lg:block lg:sticky lg:top-10">
          <p className="text-[13px] text-muted mb-2">{smartOrder?.area ?? "Bangalore"}</p>
          <h1 className="font-display font-semibold text-[30px] lg:text-[40px] leading-[1.08] tracking-[-0.025em] text-ink mb-5">
            What are you Bhookmarking now?
          </h1>

          <div className="relative mb-4">
            <svg viewBox="0 0 24 24" className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-faint pointer-events-none" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4 4" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a dish, craving or place"
              aria-label="Search a dish, craving or place"
              className="w-full bg-surface border border-line rounded-2xl pl-11 pr-4 py-3.5 text-[16px] text-ink placeholder:text-faint outline-none focus:border-rose transition-colors"
            />
          </div>

          <div
            role="list"
            aria-label="Cravings"
            className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-1 mb-5 lg:mx-0 lg:px-0 lg:flex-wrap lg:overflow-visible"
            style={{ scrollbarWidth: "none" }}
          >
            {realCategories === null
              ? [0, 1, 2, 3].map((i) => <div key={i} className="shrink-0 h-11 w-32 rounded-full bg-surface2 animate-pulse" />)
              : orderedCategories.map((name) => (
                  <motion.button
                    key={name}
                    role="listitem"
                    whileTap={TAP_SCALE}
                    transition={LIQUID_SPRING}
                    onClick={() => setView({ name: "results", category: name })}
                    className="shrink-0 flex items-center gap-2 h-11 pl-1.5 pr-4 rounded-full bg-surface border border-line text-[14px] text-ink whitespace-nowrap hover:border-rose/50 focus-visible:border-rose outline-none transition-colors"
                  >
                    <span className="w-8 h-8 rounded-full bg-accentDim text-rose flex items-center justify-center">
                      <CategoryGlyph category={name} className="w-[19px] h-[19px]" />
                    </span>
                    {name}
                  </motion.button>
                ))}
          </div>

          <NearYou
            className="order-2 mt-9 lg:mt-0"
            smartOrder={smartOrder}
            loading={smartLoading}
            error={smartError}
            dismissed={smartDismissed}
            onEnable={enableSmartPicks}
            onDismiss={dismissSmartPicks}
            onOpen={() => setView({ name: "nearby" })}
          />
        </div>

        <div className="contents lg:block">
          {q ? (
            <div className="order-1 mt-9 lg:mt-0">
              {filteredCategories.length > 0 && (
                <section className="mb-6">
                  <SectionHeading>Cravings matching "{q}"</SectionHeading>
                  <div className="flex gap-2 flex-wrap">
                    {filteredCategories.map((name) => (
                      <button
                        key={name}
                        onClick={() => setView({ name: "results", category: name })}
                        className="flex items-center gap-2 h-11 pl-2 pr-4 bg-surface border border-line rounded-full text-[14px] text-ink"
                      >
                        <CategoryGlyph category={name} className="w-[18px] h-[18px] text-rose" />
                        {name}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <SectionHeading>Places matching "{q}"</SectionHeading>
                {q.length < 2 || nameSearchResults === null ? (
                  <div className="flex flex-col gap-2.5">
                    {[0, 1].map((i) => (
                      <div key={i} className="h-[76px] rounded-card bg-surface2 animate-pulse" />
                    ))}
                  </div>
                ) : nameSearchResults.length === 0 ? (
                  <div className="border border-dashed border-line rounded-card px-6 py-10 text-center">
                    <h3 className="text-[16px] font-medium text-ink mb-1.5">Nothing matches "{q}" yet</h3>
                    <p className="text-muted text-[14px] max-w-[34ch] mx-auto">It might be a real place we don't have yet — open Places near you to search by name and add it.</p>
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
                          wide
                          className="bg-surface border border-line"
                          contentClassName="flex items-center gap-3 p-3"
                          panel={() => (
                            <DishPanel dish={venueToDishEntry(v)} mediaId={`${id}-media`} photo={v.photo} userAllergens={userAllergens} onLog={onLogDish} />
                          )}
                        >
                          <FloatMedia id={`${id}-media`} photo={v.photo} category={v.category} className="w-14 h-14 shrink-0" radius={14} compact />
                          <div className="min-w-0 flex-1">
                            <div className="text-[15px] text-ink truncate">{v.name}</div>
                            <div className="text-muted text-[13px] truncate">
                              {v.area}
                              {v.category ? ` · ${v.category}` : ""}
                            </div>
                          </div>
                          <span className="text-faint shrink-0" aria-hidden="true">
                            ›
                          </span>
                        </FloatCard>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <>
              {stackCards.length > 0 && (
                <section className="order-1 mt-9 lg:mt-0 lg:mb-10">
                  <SectionHeading>Worth a look</SectionHeading>
                  <TrendingStack
                    cards={stackCards}
                    renderPanel={(dish, mediaId) => (
                      <DishPanel dish={dish} mediaId={mediaId} photo={dish.photo} userAllergens={userAllergens} onLog={onLogDish} />
                    )}
                  />
                </section>
              )}

              {picks === null ? (
                <section className="order-3 mt-10 lg:mt-0 mb-10">
                  <SectionHeading>Recommended for you</SectionHeading>
                  <div className="flex gap-3 overflow-x-auto -mx-5 px-5 lg:mx-0 lg:px-0 lg:grid lg:grid-cols-2 lg:gap-4" style={{ scrollbarWidth: "none" }}>
                    {[0, 1].map((i) => (
                      <div key={i} className="shrink-0 w-[15.5rem] lg:w-auto">
                        <div className="aspect-[4/3] rounded-card bg-surface2 animate-pulse mb-2.5" />
                        <div className="h-4 w-3/4 rounded bg-surface2 animate-pulse mb-2" />
                        <div className="h-3.5 w-1/2 rounded bg-surface2 animate-pulse" />
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                picks.length > 0 && (
                  <Reveal className="order-3 mt-10 lg:mt-0 mb-10">
                    <section>
                      <SectionHeading>Recommended for you</SectionHeading>
                      <div
                        className="flex gap-3 overflow-x-auto -mx-5 px-5 pb-2 lg:mx-0 lg:px-0 lg:pb-0 lg:grid lg:grid-cols-2 lg:gap-4 lg:overflow-visible"
                        style={{ scrollbarWidth: "none" }}
                      >
                        {picks.map((p) => {
                          // Pick ids are DB ids; the photographed catalog dishes live on
                          // as DB rows under new ids, so match the same dish at the same
                          // venue by name — never a different venue's photo.
                          const photo = dishById(p.id)?.photo ?? DISHES.find((d) => d.name === p.name && d.venue === p.venue)?.photo;
                          const id = `pick-${p.id}`;
                          return (
                            <div key={p.id} className="relative shrink-0 w-[15.5rem] lg:w-auto">
                              <FloatCard
                                id={id}
                                label={p.name}
                                wide
                                className="bg-surface border border-line"
                                panel={() => (
                                  <DishPanel dish={toDishEntry(p)} mediaId={`${id}-media`} photo={photo} reason={p.reason} userAllergens={userAllergens} onLog={onLogDish} />
                                )}
                              >
                                <FloatMedia id={`${id}-media`} photo={photo} category={p.category} className="aspect-[4/3]" />
                                <div className="p-3.5">
                                  <span className="dish-name text-[20px] text-ink line-clamp-2">{p.name}</span>
                                  <span className="block text-muted text-[14px] mt-1 truncate">{placeLine(p)}</span>
                                </div>
                              </FloatCard>
                              <CardSaveButton
                                cardId={id}
                                dish={{ name: p.name, venue: p.venue, area: p.area, category: p.category, subtype: p.subtype }}
                                className="absolute top-2.5 right-2.5 z-10"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  </Reveal>
                )
              )}

              {digest && digest.logsThisWeek > 0 && (
                <Reveal className="order-3 border-t border-line pt-4">
                  <p className="text-[14px] text-muted leading-relaxed">
                    This week: {digest.logsThisWeek} dish{digest.logsThisWeek > 1 ? "es" : ""} logged, mostly {digest.topCategoryThisWeek}.
                    {digest.personalBestThisWeek && (
                      <>
                        {" "}Your best was <span className="text-ink">{digest.personalBestThisWeek.name}</span> at {digest.personalBestThisWeek.score.toFixed(1)}.
                      </>
                    )}
                  </p>
                </Reveal>
              )}
            </>
          )}
        </div>
      </motion.div>
    );
  }

  if (view.name === "results") {
    const dishes = browseResults ?? [];
    const safeIndex = Math.min(resultIndex, Math.max(dishes.length - 1, 0));
    const current = dishes[safeIndex];
    const canPrev = safeIndex > 0;
    const canNext = safeIndex < dishes.length - 1;

    return (
      <motion.div
        key={`results-${view.category}`}
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={LIQUID_SPRING}
        className="px-5 pt-6 pb-32 lg:max-w-[620px] lg:mx-auto"
      >
        <BackRow label={view.category} onBack={() => setView({ name: "search" })} />
        <div className="flex items-center justify-between mb-4">
          <p className="text-[14px] text-muted">
            {browseResults === null ? "Loading…" : `${dishes.length} ${view.category.toLowerCase()} spot${dishes.length === 1 ? "" : "s"} in Bangalore`}
          </p>
          {dishes.length > 1 && (
            <p className="text-[13px] text-muted tabular">
              {safeIndex + 1} / {dishes.length}
            </p>
          )}
        </div>

        {browseResults === null ? (
          <div className="aspect-[4/3] rounded-card bg-surface2 animate-pulse" />
        ) : dishes.length === 0 ? (
          <div className="border border-dashed border-line rounded-card px-6 py-10 text-center">
            <h3 className="text-[16px] font-medium text-ink mb-1.5">Nothing here yet</h3>
            <p className="text-muted text-[14px]">Be the first — tap the + below to log one.</p>
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
                wide
                className="bg-surface border border-line"
                panel={() => (
                  <DishPanel dish={toDishEntry(current)} mediaId={`result-${current.id}-media`} photo={current.photo} userAllergens={userAllergens} onLog={onLogDish} />
                )}
              >
                <FloatMedia id={`result-${current.id}-media`} photo={current.photo} category={view.category} className="aspect-[4/3]" />
                <div className="p-4">
                  <span className="dish-name text-[26px] text-ink line-clamp-2">{current.name}</span>
                  <span className="block text-muted text-[15px] mt-1">{placeLine(current)}</span>
                </div>
              </FloatCard>
              <CardSaveButton
                cardId={`result-${current.id}`}
                dish={{ name: current.name, venue: current.venue, area: current.area, category: current.category, subtype: current.subtype }}
                className="absolute top-3 right-3 z-20"
              />
            </BrowseCard>

            {dishes.length > 1 ? (
              <>
                <p className="text-center text-muted text-[13px] mt-4">Swipe to browse · tap the card for details</p>
                <div className="flex items-center justify-center gap-4 mt-4">
                  <button
                    onClick={() => setResultIndex((i) => Math.max(i - 1, 0))}
                    disabled={!canPrev}
                    aria-label="Previous"
                    className="w-11 h-11 rounded-full bg-surface border border-line flex items-center justify-center text-ink disabled:opacity-30"
                  >
                    ‹
                  </button>
                  <div className="flex gap-1.5 max-w-[60%] overflow-hidden">
                    {dishes.slice(0, 12).map((d, i) => (
                      <span key={d.id} className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${i === safeIndex ? "bg-rose" : "bg-line"}`} />
                    ))}
                  </div>
                  <button
                    onClick={() => setResultIndex((i) => Math.min(i + 1, dishes.length - 1))}
                    disabled={!canNext}
                    aria-label="Next"
                    className="w-11 h-11 rounded-full bg-surface border border-line flex items-center justify-center text-ink disabled:opacity-30"
                  >
                    ›
                  </button>
                </div>
              </>
            ) : (
              <p className="text-center text-muted text-[13px] mt-4">Tap the card for details</p>
            )}
          </>
        )}
      </motion.div>
    );
  }

  return null;
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-[19px] font-semibold tracking-[-0.01em] text-ink mb-3">{children}</h2>;
}

/** Nearby discovery and location personalisation as one request: share
 * location once to reorder cravings by area/weather, then open what's close.
 * Location unavailable still leaves a useful path (cravings, name search). */
function NearYou({
  className = "",
  smartOrder,
  loading,
  error,
  dismissed,
  onEnable,
  onDismiss,
  onOpen,
}: {
  className?: string;
  smartOrder: SmartOrderResult | null;
  loading: boolean;
  error: string | null;
  dismissed: boolean;
  onEnable: () => void;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  if (dismissed && !smartOrder) {
    return (
      <button onClick={onOpen} className={`w-full flex items-center gap-3 bg-surface border border-line rounded-2xl px-4 h-14 text-left ${className}`}>
        <PinGlyph />
        <span className="flex-1 text-[15px] text-ink">Places near you</span>
        <span className="text-faint" aria-hidden="true">
          ›
        </span>
      </button>
    );
  }

  const body = smartOrder
    ? smartOrder.reasons.length > 0
      ? smartOrder.reasons.join(" · ")
      : "Cravings are sorted for where you are."
    : error
      ? `${error} You can still pick a craving above or search a place by name.`
      : "Share your location once to sort cravings by your area and weather, and to see what's close. Nothing is stored.";

  return (
    <section aria-labelledby="near-you" className={`bg-surface border border-line rounded-card p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-full bg-accentDim flex items-center justify-center shrink-0">
          <PinGlyph />
        </span>
        <div className="flex-1 min-w-0">
          <h2 id="near-you" className="text-[16px] font-medium text-ink">
            {smartOrder?.area ? `Near ${smartOrder.area}` : "Places near you"}
          </h2>
          <p className="text-[14px] text-muted mt-0.5 leading-snug">{body}</p>
        </div>
        {!smartOrder && !loading && (
          <button onClick={onDismiss} aria-label="Hide location suggestion" className="w-11 h-11 -mt-2 -mr-2 shrink-0 text-faint flex items-center justify-center">
            ✕
          </button>
        )}
      </div>
      <div className="flex gap-2 mt-3.5">
        {smartOrder ? (
          <button onClick={onOpen} className="flex-1 h-11 rounded-xl gradient-primary text-accentInk text-[15px] font-medium">
            See places near you
          </button>
        ) : (
          <>
            <button onClick={onEnable} disabled={loading} className="flex-1 h-11 rounded-xl gradient-primary text-accentInk text-[15px] font-medium disabled:opacity-60">
              {loading ? "Checking your location…" : error ? "Try again" : "Use my location"}
            </button>
            {error && (
              <button onClick={onOpen} className="h-11 px-4 rounded-xl border border-line text-[14px] text-ink">
                Search by name
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function PinGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0 text-rose" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}

function BackRow({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <button onClick={onBack} aria-label="Back" className="w-11 h-11 rounded-full bg-surface border border-line flex items-center justify-center text-ink">
        ‹
      </button>
      <h2 className="font-display font-semibold text-[20px] truncate">{label}</h2>
    </div>
  );
}
