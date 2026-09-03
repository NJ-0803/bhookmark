import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";
import { CATEGORIES, DISHES, categoryVisual, dishById, dishesForSubtype } from "../data/dishes";
import type { Category, DishEntry } from "../types";
import DishThumb from "../components/DishThumb";
import ScoreBadge from "../components/ScoreBadge";
import WhyThis from "../components/WhyThis";
import BrowseCard from "../components/BrowseCard";
import { getDietProfile, getDigest, getNextPicks, getDishScore, getTrending, type DishScoreResponse, type TrendingResponse } from "../api";
import { computeSmartOrder, type SmartOrderResult } from "../smartPicks";
import NearMe from "./NearMe";

// Restrained per-category accents (brief's Phase 5 direction: "chilli red,
// saffron, butter yellow, coffee brown" instead of one flat accent color
// everywhere) — used on badges and the spotlight card, never as a full
// background swap of the black+turquoise base identity.
const CATEGORY_ACCENT: Record<Category, string> = {
  "Dosa & Idli": "bg-amber-400 text-amber-950",
  Biryani: "bg-orange-600 text-orange-50",
  "Filter Coffee": "bg-amber-800 text-amber-50",
  Burger: "bg-rose-500 text-rose-50",
  Pizza: "bg-red-600 text-red-50",
  Momos: "bg-teal-500 text-teal-950",
};

const SMART_ORDER_CACHE_KEY = "palate.smartOrder";
const SMART_ORDER_DISMISSED_KEY = "palate.smartOrderDismissed";
const SMART_ORDER_MAX_AGE_MS = 3 * 60 * 60 * 1000; // weather goes stale fast

interface Pick {
  id: string;
  category: string;
  subtype: string;
  name: string;
  venue: string;
  score: number;
  reason: string;
  reasonSource: "llm" | "template";
}

interface DigestData {
  daysSinceLastLog: number | null;
  logsThisWeek: number;
  topCategoryThisWeek: string | null;
  personalBestThisWeek: { name: string; venue: string; score: number } | null;
}

type View =
  | { name: "search" }
  | { name: "subtype"; category: Category }
  | { name: "results"; category: Category; subtype: string }
  | { name: "profile"; dish: DishEntry }
  | { name: "nearby" };

export default function Home({ onLogDish }: { onLogDish: (dish: DishEntry) => void }) {
  const [view, setView] = useState<View>({ name: "search" });
  const [query, setQuery] = useState("");
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [userAllergens, setUserAllergens] = useState<string[]>([]);
  const [dishScore, setDishScore] = useState<DishScoreResponse | null>(null);
  const [resultIndex, setResultIndex] = useState(0);
  const [smartOrder, setSmartOrder] = useState<SmartOrderResult | null>(null);
  const [trending, setTrending] = useState<TrendingResponse["trending"] | null>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartDismissed, setSmartDismissed] = useState(() => localStorage.getItem(SMART_ORDER_DISMISSED_KEY) === "1");

  const resultsKey = view.name === "results" ? `${view.category}|${view.subtype}` : null;
  useEffect(() => {
    setResultIndex(0);
  }, [resultsKey]);

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
        setSmartOrder({ categories: cached.categories, reasons: cached.reasons });
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

  // Score separation (brief 1.2): the profile view below shows Your/Community/
  // Verified-only ratings from real published logs, not the static seed score.
  useEffect(() => {
    if (view.name !== "profile") {
      setDishScore(null);
      return;
    }
    const d = view.dish;
    getDishScore(d.venue, d.category, d.subtype, d.name)
      .then((res) => setDishScore(res.ok ? res : null))
      .catch(() => setDishScore(null));
  }, [view]);

  const orderedCategories = useMemo(() => {
    if (!smartOrder) return CATEGORIES;
    const byName = new Map(CATEGORIES.map((c) => [c.name, c]));
    const ordered = smartOrder.categories.map((name) => byName.get(name)).filter((c): c is (typeof CATEGORIES)[number] => !!c);
    return ordered.length === CATEGORIES.length ? ordered : CATEGORIES;
  }, [smartOrder]);

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return orderedCategories;
    return orderedCategories.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (c.subtypes.some((s) => s.toLowerCase().includes(q))) return true;
      return DISHES.some((d) => d.category === c.name && (d.name.toLowerCase().includes(q) || d.venue.toLowerCase().includes(q)));
    });
  }, [query, orderedCategories]);

  // Fallback spotlight when there's no real trending signal yet (the
  // expected, honest state pre-launch): a highest-scored seed dish, labeled
  // "Top rated" — never "trending", since that has no time window behind it.
  const fallbackSpotlight = useMemo(() => {
    const topCategory = smartOrder?.categories[0];
    const pool = topCategory ? DISHES.filter((d) => d.category === topCategory) : DISHES;
    const source = pool.length ? pool : DISHES;
    return [...source].sort((a, b) => b.score - a.score)[0];
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

  if (view.name === "nearby") {
    return <NearMe onBack={() => setView({ name: "search" })} />;
  }

  if (view.name === "search") {
    return (
      <motion.div key="search" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={LIQUID_SPRING} className="px-5 pt-8 pb-32">
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint mb-2">Bangalore · Today</p>
        <h1 className="font-display font-extrabold text-3xl leading-tight mb-1 text-balance">
          What's your foodgasm<br />today? 🤤
        </h1>
        <p className="text-muted text-sm mb-4">Pick a craving. We'll do the rest.</p>

        <div className="flex gap-4 overflow-x-auto mb-5 -mx-5 px-5" style={{ scrollbarWidth: "none" }}>
          {orderedCategories.map((c) => {
            const visual = categoryVisual(c.name);
            return (
              <motion.button
                key={c.name}
                whileTap={TAP_SCALE}
                transition={LIQUID_SPRING}
                onClick={() => setView({ name: "subtype", category: c.name })}
                className="shrink-0 flex flex-col items-center gap-1.5 w-16"
              >
                <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-line relative">
                  {visual.photo ? (
                    <img src={visual.photo} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className={`absolute inset-0 bg-gradient-to-br ${visual.tint} bg-surface2 flex items-center justify-center text-2xl`}>
                      {visual.emoji}
                    </div>
                  )}
                </div>
                <span className="text-[11px] font-medium text-muted truncate w-full text-center">{c.name}</span>
              </motion.button>
            );
          })}
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a craving — burger, dosa, biryani…"
          className="w-full bg-surface border border-line rounded-xl px-4 py-3.5 text-[15px] placeholder:text-faint outline-none focus:border-accent transition-colors mb-4"
        />

        {smartOrder ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mb-4 px-1">
            {smartOrder.reasons.map((r, i) => (
              <span key={i} className="text-faint text-[11px]">{r}</span>
            ))}
          </div>
        ) : (
          !smartDismissed && (
            <div className="flex items-center gap-3 bg-surface border border-line rounded-xl px-4 py-3 mb-4">
              <button onClick={enableSmartPicks} disabled={smartLoading} className="flex-1 flex items-center gap-3 text-left">
                <span className="text-xl">🌍</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{smartLoading ? "Checking your location & weather…" : "Personalize by where you are"}</div>
                  <div className="text-faint text-xs mt-0.5">Real location + live weather, reorders categories — nothing stored or shared</div>
                </div>
              </button>
              {!smartLoading && (
                <button onClick={dismissSmartPicks} className="text-faint text-xs shrink-0 px-1" aria-label="Dismiss">
                  ✕
                </button>
              )}
            </div>
          )
        )}

        {!query.trim() && (trendingSpotlight || fallbackSpotlight) && (() => {
          const dish = trendingSpotlight ?? fallbackSpotlight;
          return (
            <motion.button
              key={dish.id}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={LIQUID_SPRING}
              onClick={() => setView({ name: "profile", dish })}
              className="relative w-full aspect-[16/10] rounded-card overflow-hidden text-left mb-5 border border-line"
            >
              {dish.photo ? (
                <img src={dish.photo} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className={`absolute inset-0 bg-gradient-to-br ${dish.tint} bg-surface2 flex items-center justify-center text-6xl`}>
                  {dish.emoji}
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/10" />
              <span className={`absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${CATEGORY_ACCENT[dish.category]}`}>
                {trendingSpotlight ? `🔥 Trending — ${trending!.count} logs this week` : "⭐ Top rated"}
              </span>
              {!trendingSpotlight && <ScoreBadge score={dish.score} size="sm" className="absolute top-3 right-3" />}
              <div className="relative h-full flex flex-col justify-end p-4">
                <div className="font-display font-extrabold text-xl text-white leading-tight drop-shadow">{dish.name}</div>
                <div className="text-white/70 text-sm mt-0.5">{dish.venue} · {dish.area}</div>
              </div>
            </motion.button>
          );
        })()}

        <button
          onClick={() => setView({ name: "nearby" })}
          className="w-full flex items-center gap-3 bg-gradient-to-r from-accentDim to-surface border border-accent/30 rounded-xl px-4 py-3.5 mb-6 text-left"
        >
          <span className="text-xl">📍</span>
          <div className="flex-1">
            <div className="font-semibold text-sm text-accent">Near me, right now</div>
            <div className="text-faint text-xs mt-0.5">Share your location, pick a craving, see what's actually close</div>
          </div>
          <span className="text-faint">›</span>
        </button>

        {digest && (digest.daysSinceLastLog === null || digest.daysSinceLastLog >= 1) && (
          <div className="bg-surface border border-line rounded-card p-4 mb-6">
            <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-accent mb-1.5">👀 while you were gone</p>
            {digest.logsThisWeek > 0 ? (
              <p className="text-sm text-ink/90">
                {digest.logsThisWeek} dish{digest.logsThisWeek > 1 ? "es" : ""} logged this week, mostly{" "}
                <span className="font-semibold">{digest.topCategoryThisWeek}</span>. Certified {digest.topCategoryThisWeek?.toLowerCase()} enjoyer.
                {digest.personalBestThisWeek && (
                  <> Your best was <span className="text-accent font-semibold">{digest.personalBestThisWeek.name}</span> at {digest.personalBestThisWeek.score.toFixed(1)} 🔥</>
                )}
              </p>
            ) : (
              <p className="text-sm text-ink/90">
                {digest.daysSinceLastLog === null ? "You haven't logged a single dish yet — Palate's judging you a little. 👀" : `It's been ${digest.daysSinceLastLog} day${digest.daysSinceLastLog === 1 ? "" : "s"} since your last log. Life happens, come back.`}
              </p>
            )}
          </div>
        )}

        {picks === null ? (
          <div className="mb-7">
            <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-3">Recommended for you</p>
            <div className="flex gap-3 overflow-x-auto -mx-5 px-5" style={{ scrollbarWidth: "none" }}>
              {[0, 1].map((i) => (
                <div key={i} className="shrink-0 w-64">
                  <div className="aspect-[4/3] rounded-card bg-surface2 animate-pulse mb-2" />
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
                  const visual = categoryVisual(p.category);
                  const photo = dishById(p.id)?.photo;
                  return (
                    <div key={p.id} className="shrink-0 w-64 bg-surface border border-line rounded-card overflow-hidden">
                      <button
                        onClick={() => {
                          const dish = dishById(p.id);
                          if (dish) setView({ name: "profile", dish });
                        }}
                        className="block w-full text-left"
                      >
                        <div className="relative aspect-[4/3]">
                          {photo ? (
                            <img src={photo} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className={`absolute inset-0 bg-gradient-to-br ${visual.tint} bg-surface2 flex items-center justify-center text-4xl`}>
                              {visual.emoji}
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                          <span className={`absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${CATEGORY_ACCENT[p.category as Category]}`}>
                            {p.category}
                          </span>
                          <ScoreBadge score={p.score} size="sm" className="absolute top-2 right-2" />
                        </div>
                        <div className="p-3 pb-0">
                          <div className="font-semibold text-sm truncate">{p.name}</div>
                          <div className="text-faint text-xs mb-1.5 truncate">{p.venue}</div>
                          <p className="text-ink/80 text-xs leading-snug line-clamp-2">{p.reason}</p>
                        </div>
                      </button>
                      <div className="px-3 pb-3">
                        <WhyThis
                          body={
                            p.reasonSource === "llm"
                              ? "Grounded in your real dietary profile and log history — an AI model only rewrote the sentence, it never chose the dish or invented a fact not already in your data."
                              : "Grounded in your real dietary profile and log history — a fixed template, no AI model was involved in wording this one."
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}

        {query.trim() && (
          <>
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-3">
          Matching "{query.trim()}"
        </p>
        {filteredCategories.length === 0 ? (
          <div className="border border-dashed border-line rounded-card px-6 py-10 text-center">
            <div className="text-3xl mb-3">🔍</div>
            <h3 className="font-display font-bold text-lg mb-1.5">Nothing matches "{query.trim()}" yet</h3>
            <p className="text-muted text-sm mb-2 max-w-[30ch] mx-auto">
              Not one of our categories, and not a subtype or dish name either.
            </p>
            <p className="text-faint text-xs max-w-[32ch] mx-auto">
              Tap the <span className="text-accent font-semibold">+</span> below, and choose "Other — not listed" as the category — Palate learns new categories from real logs.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredCategories.map((c, i) => {
              const visual = categoryVisual(c.name);
              return (
                <motion.button
                  key={c.name}
                  onClick={() => setView({ name: "subtype", category: c.name })}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...LIQUID_SPRING, delay: i * 0.05 }}
                  whileTap={TAP_SCALE}
                  className="relative aspect-[4/5] rounded-card overflow-hidden text-left border border-line"
                >
                  {visual.photo && (
                    <img src={visual.photo} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/10" />
                  <div className="relative h-full flex flex-col justify-end p-4">
                    <div className="text-2xl mb-2 drop-shadow">{c.emoji}</div>
                    <div className="font-display font-bold text-base text-white leading-tight">{c.name}</div>
                    <div className="text-white/60 text-xs mt-0.5">{c.subtypes.length} subtypes</div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
          </>
        )}
      </motion.div>
    );
  }

  if (view.name === "subtype") {
    const cat = CATEGORIES.find((c) => c.name === view.category)!;
    return (
      <motion.div key={`subtype-${view.category}`} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={LIQUID_SPRING} className="px-5 pt-6 pb-32">
        <BackRow label={view.category} onBack={() => setView({ name: "search" })} />
        <p className="text-muted text-sm mb-5">Narrow it down so duels stay fair — a benne dosa never has to compete with a set dosa.</p>
        <div className="flex flex-col gap-2.5">
          {cat.subtypes.map((s) => (
            <button
              key={s}
              onClick={() => setView({ name: "results", category: view.category, subtype: s })}
              className="flex items-center justify-between bg-surface border border-line rounded-xl px-4 py-3.5 text-left hover:border-accent/50 transition-colors"
            >
              <span className="font-medium text-sm">{s}</span>
              <span className="text-faint">›</span>
            </button>
          ))}
        </div>
      </motion.div>
    );
  }

  if (view.name === "results") {
    const dishes = dishesForSubtype(view.category, view.subtype);
    const safeIndex = Math.min(resultIndex, Math.max(dishes.length - 1, 0));
    const current = dishes[safeIndex];
    const canPrev = safeIndex > 0;
    const canNext = safeIndex < dishes.length - 1;

    return (
      <motion.div key={`results-${view.category}-${view.subtype}`} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={LIQUID_SPRING} className="px-5 pt-6 pb-32">
        <BackRow label={view.subtype} onBack={() => setView({ name: "subtype", category: view.category })} />
        <div className="flex items-center justify-between mb-4">
          <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint">
            {dishes.length} {view.subtype.toLowerCase()} spot{dishes.length === 1 ? "" : "s"} in Bangalore
          </p>
          {dishes.length > 1 && (
            <p className="font-mono text-[11px] text-faint tabular">{safeIndex + 1} / {dishes.length}</p>
          )}
        </div>

        {dishes.length === 0 ? (
          <div className="border border-dashed border-line rounded-card px-6 py-10 text-center">
            <div className="text-3xl mb-3">🍽️</div>
            <h3 className="font-display font-bold text-lg mb-1.5">Nothing logged here yet</h3>
            <p className="text-muted text-sm">Be the first — tap the + below to log one.</p>
          </div>
        ) : (
          <>
            <AnimatePresence mode="wait">
              <BrowseCard
                key={current.id}
                cardKey={current.id}
                canNext={canNext}
                canPrev={canPrev}
                onSwipeNext={() => setResultIndex((i) => Math.min(i + 1, dishes.length - 1))}
                onSwipePrev={() => setResultIndex((i) => Math.max(i - 1, 0))}
                className="bg-surface border border-line rounded-card overflow-hidden"
              >
                <button onClick={() => setView({ name: "profile", dish: current })} className="block w-full text-left">
                  <DishThumb emoji={current.emoji} tint={current.tint} photo={current.photo} size="lg" scrim />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-display font-bold text-lg leading-tight truncate">{current.name}</div>
                        <div className="text-faint text-sm mt-0.5 truncate">{current.venue} · {current.area}</div>
                      </div>
                      <ScoreBadge score={current.score} />
                    </div>
                  </div>
                </button>
              </BrowseCard>
            </AnimatePresence>

            {dishes.length > 1 ? (
              <>
                <p className="text-center text-faint text-xs mt-4">Swipe to browse · tap a card for the full profile</p>
                <div className="flex items-center justify-center gap-4 mt-4">
                  <button
                    onClick={() => setResultIndex((i) => Math.max(i - 1, 0))}
                    disabled={!canPrev}
                    className="w-9 h-9 rounded-full bg-surface border border-line flex items-center justify-center text-muted disabled:opacity-30"
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
                    className="w-9 h-9 rounded-full bg-surface border border-line flex items-center justify-center text-muted disabled:opacity-30"
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

  // profile
  const d = view.dish;
  return (
    <motion.div key={`profile-${d.id}`} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={LIQUID_SPRING} className="pb-32">
      <div className="px-5 pt-6">
        <BackRow
          label="Dish"
          onBack={() =>
            setView({ name: "results", category: d.category, subtype: d.subtype })
          }
        />
      </div>
      <div className="px-5">
        <DishThumb emoji={d.emoji} tint={d.tint} photo={d.photo} size="lg" />
      </div>
      <div className="px-5 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-xl leading-tight">{d.name}</h2>
            <p className="text-muted text-sm mt-1">{d.venue} · {d.area}</p>
          </div>
          <div className="text-right shrink-0">
            {dishScore === null ? (
              <div className="font-mono text-2xl font-semibold text-faint tabular">···</div>
            ) : dishScore.community.score !== null ? (
              <>
                <div className="font-mono text-2xl font-semibold text-accent tabular">{dishScore.community.score.toFixed(1)}</div>
                <div className="text-faint text-[11px]">/ 10 · {dishScore.community.count} logged</div>
              </>
            ) : (
              <>
                <div className="font-mono text-2xl font-semibold text-faint tabular">—</div>
                <div className="text-faint text-[11px]">no Palate logs yet</div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4 text-xs text-muted">
          <span>₹{d.priceRs}</span>
        </div>

        {dishScore && dishScore.community.count > 0 && (
          <div className="bg-surface border border-line rounded-card p-4 mt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint">Score breakdown</p>
              <ConfidenceChip band={dishScore.confidenceBand} />
            </div>
            <ScoreRow label="Community" score={dishScore.community.score} count={dishScore.community.count} />
            <ScoreRow label="Verified-only" score={dishScore.verifiedOnly.score} count={dishScore.verifiedOnly.count} />
            {dishScore.yours && <ScoreRow label="Your rating" score={dishScore.yours.score} count={1} highlight />}
            <WhyThis
              body={`Community averages every published log for this exact dish at this venue. Verified-only counts just the logs Palate could confirm with a live photo or a matched location. Confidence is "${dishScore.confidenceBand}" because it's based on ${dishScore.community.count} log${dishScore.community.count === 1 ? "" : "s"} so far — not a fixed decimal Palate is fully sure of.`}
            />
          </div>
        )}

        {d.allergens.some((a) => userAllergens.includes(a)) && (
          <div className="bg-badDim border border-bad/30 rounded-xl px-4 py-3 mt-5 text-sm text-bad">
            Contains {d.allergens.filter((a) => userAllergens.includes(a)).join(", ")} — flagged against your dietary profile.
          </div>
        )}

        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mt-6 mb-2">Consensus notes</p>
        <div className="flex flex-wrap gap-2">
          {d.tasteNotes.map((n) => (
            <span key={n} className="text-xs bg-surface border border-line rounded-full px-3 py-1.5 text-ink/90">
              {n}
            </span>
          ))}
        </div>

        <button
          onClick={() => onLogDish(d)}
          className="w-full mt-8 bg-accent text-accentInk font-semibold rounded-xl py-3.5 active:scale-[0.98] transition-transform"
        >
          I ate this — log it
        </button>
      </div>
    </motion.div>
  );
}

function ScoreRow({ label, score, count, highlight }: { label: string; score: number | null; count: number; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={`text-sm ${highlight ? "text-accent font-medium" : "text-ink/80"}`}>{label}</span>
      <span className="font-mono text-sm tabular text-ink/90">
        {score !== null ? score.toFixed(1) : "—"}
        <span className="text-faint text-[11px] ml-1.5">
          {count === 1 ? "1 log" : `${count} logs`}
        </span>
      </span>
    </div>
  );
}

function ConfidenceChip({ band }: { band: "insufficient" | "early" | "developing" | "strong" }) {
  const copy = { insufficient: "no data", early: "early", developing: "developing", strong: "strong" }[band];
  const tone =
    band === "strong" ? "bg-accentDim text-accent" :
    band === "developing" ? "bg-gold/10 text-gold" :
    "bg-surface2 text-faint";
  return <span className={`text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full ${tone}`}>{copy}</span>;
}

function BackRow({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <button onClick={onBack} className="w-8 h-8 rounded-full bg-surface border border-line flex items-center justify-center text-muted">
        ‹
      </button>
      <h2 className="font-display font-semibold text-lg truncate">{label}</h2>
    </div>
  );
}
