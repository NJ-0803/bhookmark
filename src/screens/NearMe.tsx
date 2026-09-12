import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { categoryVisual } from "../data/dishes";
import { getNearbyVenues, getVenueCategories, searchVenues, submitVenue, type NearbyVenue, type VenueSearchResult } from "../api";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";

type Mode = "craving" | "name";

type Stage =
  | { name: "pick" }
  | { name: "locating" }
  | { name: "results"; venues: NearbyVenue[]; category: string; categoryResolved: boolean }
  | { name: "error"; message: string };

type SearchStage =
  | { name: "idle" }
  | { name: "searching" }
  | { name: "results"; results: VenueSearchResult[]; query: string }
  | { name: "error"; message: string };

export default function NearMe({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<Mode>("craving");
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string>("Coffee");
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const [radiusKm, setRadiusKm] = useState(5);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchStage, setSearchStage] = useState<SearchStage>({ name: "idle" });

  const [showSubmit, setShowSubmit] = useState(false);

  // Fetched, not hardcoded — see api.ts's getVenueCategories comment for
  // why duplicating this list client-side is exactly the bug this app
  // already shipped once (Coffee search silently breaking because a
  // hardcoded copy drifted from the real category list).
  useEffect(() => {
    getVenueCategories().then((res) => {
      if (res.ok && res.categories.length) {
        setCategories(res.categories);
        if (!res.categories.includes(category)) setCategory(res.categories[0]);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function findNearby() {
    if (!navigator.geolocation) {
      setStage({ name: "error", message: "This browser can't share your location." });
      return;
    }
    setStage({ name: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await getNearbyVenues(category, pos.coords.latitude, pos.coords.longitude, radiusKm);
          if (!res.ok) {
            setStage({ name: "error", message: res.error ?? "Couldn't load nearby joints." });
            return;
          }
          setStage({ name: "results", venues: res.results, category, categoryResolved: res.categoryResolved });
        } catch {
          setStage({ name: "error", message: "Can't reach the Bhookmark API." });
        }
      },
      (err) => {
        setStage({
          name: "error",
          message: err.code === err.PERMISSION_DENIED
            ? "Location access was denied. Bhookmark never sees or stores your exact location otherwise — it's only sent for this one search."
            : "Couldn't get your location. Try again.",
        });
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }

  async function runSearch() {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    setSearchStage({ name: "searching" });
    try {
      // Distance is a nice-to-have here, never required — name search has
      // to work even if location is denied, that's the whole point of it
      // being a separate path from "near me."
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const res = await searchVenues(q, pos.coords.latitude, pos.coords.longitude);
            setSearchStage(res.ok ? { name: "results", results: res.results, query: q } : { name: "error", message: res.error ?? "Search failed." });
          },
          async () => {
            const res = await searchVenues(q);
            setSearchStage(res.ok ? { name: "results", results: res.results, query: q } : { name: "error", message: res.error ?? "Search failed." });
          },
          { enableHighAccuracy: false, timeout: 4000 }
        );
      } else {
        const res = await searchVenues(q);
        setSearchStage(res.ok ? { name: "results", results: res.results, query: q } : { name: "error", message: res.error ?? "Search failed." });
      }
    } catch {
      setSearchStage({ name: "error", message: "Can't reach the Bhookmark API." });
    }
  }

  return (
    <div className="px-5 pt-6 pb-32">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} aria-label="Back" className="w-11 h-11 rounded-full bg-surface border border-line flex items-center justify-center text-muted">‹</button>
        <h1 className="font-display font-semibold text-lg">Near me</h1>
      </div>

      <div className="flex gap-2 mb-6 bg-surface2 rounded-xl p-1">
        <button
          onClick={() => setMode("craving")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium ${mode === "craving" ? "bg-accent text-accentInk" : "text-muted"}`}
        >
          By craving
        </button>
        <button
          onClick={() => setMode("name")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium ${mode === "name" ? "bg-accent text-accentInk" : "text-muted"}`}
        >
          By name
        </button>
      </div>

      {mode === "name" ? (
        <>
          <p className="text-muted text-sm mb-4">Search for a specific cafe, bakery, pub, or restaurant by name — works even if we don't know what it serves yet.</p>
          <div className="flex gap-2 mb-5">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Search a place — e.g. Third Wave, CTR…"
              aria-label="Search venues by name"
              className="flex-1 bg-surface border border-line rounded-xl px-4 py-3 text-[15px] outline-none focus:border-accent transition-colors"
            />
            <motion.button onClick={runSearch} whileTap={TAP_SCALE} className="px-4 bg-accent text-accentInk font-semibold rounded-xl">
              Go
            </motion.button>
          </div>

          {searchStage.name === "searching" && (
            <div className="text-center py-10">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted text-sm">Searching…</p>
            </div>
          )}
          {searchStage.name === "error" && (
            <div className="bg-badDim border border-bad/30 rounded-xl px-4 py-4 text-sm text-bad">{searchStage.message}</div>
          )}
          {searchStage.name === "results" && (
            <>
              <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-4">
                {searchStage.results.length} match{searchStage.results.length === 1 ? "" : "es"} for "{searchStage.query}"
              </p>
              {searchStage.results.length === 0 ? (
                <div className="border border-dashed border-line rounded-card px-6 py-10 text-center mb-5">
                  <p className="text-muted text-sm mb-1">Nothing found for "{searchStage.query}"</p>
                  <p className="text-faint text-xs">It might be a real place that isn't mapped yet — add it below.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5 mb-5">
                  {searchStage.results.map((v) => (
                    <SearchResultCard key={v.id} venue={v} />
                  ))}
                </div>
              )}
            </>
          )}

          <SubmitVenueLink show={showSubmit} setShow={setShowSubmit} categories={categories} prefillName={searchStage.name === "results" ? searchStage.query : ""} />
        </>
      ) : (
        <>
          {stage.name === "pick" && (
            <>
              <p className="text-muted text-sm mb-6">Pick a craving, share your location for a moment, and see every real joint serving it nearby.</p>

              <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-3">Craving</p>
              <div className="grid grid-cols-2 gap-2.5 mb-6">
                {categories.map((c) => {
                  const visual = categoryVisual(c);
                  return (
                    <motion.button
                      key={c}
                      onClick={() => setCategory(c)}
                      whileTap={TAP_SCALE}
                      transition={LIQUID_SPRING}
                      className={`flex items-center gap-2.5 rounded-xl px-3.5 py-3 border text-left ${
                        category === c ? "bg-accent border-accent text-accentInk" : "bg-surface border-line"
                      }`}
                    >
                      <span className="text-lg">{visual.emoji}</span>
                      <span className="font-medium text-sm">{c}</span>
                    </motion.button>
                  );
                })}
              </div>

              <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-2">Radius</p>
              <input type="range" min={1} max={10} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} aria-label="Search radius in kilometers" className="w-full accent-accent mb-1" />
              <p className="text-sm text-ink/80 mb-7">{radiusKm} km from wherever you are right now</p>

              <motion.button onClick={findNearby} whileTap={TAP_SCALE} transition={LIQUID_SPRING} className="w-full bg-accent text-accentInk font-semibold rounded-xl py-3.5">
                Use my location
              </motion.button>
              <p className="text-faint text-[11px] text-center mt-3">Used once for this search, never stored — see Privacy in your profile.</p>
            </>
          )}

          {stage.name === "locating" && (
            <div className="text-center py-16">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted text-sm">Finding {category.toLowerCase()} joints near you…</p>
            </div>
          )}

          {stage.name === "error" && (
            <div className="bg-badDim border border-bad/30 rounded-xl px-4 py-4 text-sm text-bad">
              {stage.message}
              <button onClick={() => setStage({ name: "pick" })} className="block mt-3 text-xs underline text-bad/80">Try again</button>
            </div>
          )}

          {stage.name === "results" && (
            <>
              <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-4">
                {stage.venues.length} {stage.category.toLowerCase()} spot{stage.venues.length === 1 ? "" : "s"} within {radiusKm}km
              </p>
              {stage.venues.length === 0 ? (
                <div className="border border-dashed border-line rounded-card px-6 py-10 text-center mb-5">
                  <p className="text-muted text-sm mb-1">
                    {stage.categoryResolved ? `Nothing serving ${stage.category.toLowerCase()} within ${radiusKm}km yet` : `"${stage.category}" isn't a recognized category`}
                  </p>
                  <p className="text-faint text-xs">Try widening the radius, or don't see your spot? Add it below.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3 mb-5">
                  {stage.venues.map((v, i) => (
                    <VenueCard key={v.id} venue={v} index={i} category={stage.category} />
                  ))}
                </div>
              )}
              <button onClick={() => setStage({ name: "pick" })} className="w-full bg-surface border border-line rounded-xl py-3 text-sm font-medium text-muted mb-5">
                Search a different craving
              </button>
              <SubmitVenueLink show={showSubmit} setShow={setShowSubmit} categories={categories} prefillCategory={stage.category} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function CategoryPlaceholder({ category }: { category: string | null }) {
  const visual = categoryVisual(category ?? "");
  return (
    <div className={`absolute inset-0 bg-gradient-to-br ${visual.tint} bg-surface2 flex items-center justify-center text-4xl`}>
      {visual.emoji}
    </div>
  );
}

function VenueCard({ venue, index, category }: { venue: NearbyVenue; index: number; category: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...LIQUID_SPRING, delay: index * 0.05 }}
      className="bg-surface border border-line rounded-card overflow-hidden"
    >
      <div className="relative aspect-[16/9]">
        {venue.photo ? (
          <img src={venue.photo} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        ) : (
          <CategoryPlaceholder category={category} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
          <div>
            <div className="font-display font-bold text-white text-base leading-tight">{venue.name}</div>
            <div className="text-white/70 text-xs mt-0.5">{venue.area} · {venue.distanceKm} km away</div>
          </div>
          {venue.community.count > 0 && venue.community.score !== null ? (
            <span className="font-mono text-sm font-semibold text-accent bg-black/50 rounded-md px-2 py-1 tabular">{venue.community.score.toFixed(1)}</span>
          ) : (
            <span className="font-mono text-[10px] uppercase text-white/70 bg-black/50 rounded-md px-2 py-1">no logs yet</span>
          )}
        </div>
        {venue.photo && !venue.photoIsVerified && (
          <span className="absolute top-2 right-2 text-[9px] font-mono uppercase tracking-wide text-white/70 bg-black/50 rounded px-1.5 py-0.5">representative photo</span>
        )}
      </div>
      <div className="p-4">
        <span className="text-[10px] font-mono uppercase text-faint">
          {venue.community.count > 0 ? `${venue.community.count} Bhookmark review${venue.community.count === 1 ? "" : "s"}` : "no Bhookmark reviews yet"}
        </span>

        {venue.reviews.length > 0 ? (
          <>
            <button onClick={() => setExpanded((v) => !v)} className="block text-accent text-xs font-medium mt-2">
              {expanded ? "Hide reviews" : `Read ${venue.reviews.length} review${venue.reviews.length === 1 ? "" : "s"}`}
            </button>
            {expanded && (
              <div className="flex flex-col gap-2 mt-3">
                {venue.reviews.map((r, i) => (
                  <div key={i} className="bg-surface2 rounded-lg p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono text-accent">{r.score.toFixed(1)}</span>
                      <span className="text-[10px] text-faint">{r.verdict === "loved" ? "Loved it" : r.verdict === "fine" ? "It was fine" : "Not for them"}</span>
                    </div>
                    <p className="text-xs text-ink/85 leading-snug">"{r.note}"</p>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-faint text-xs mt-2">Be the first to log this one.</p>
        )}
      </div>
    </motion.div>
  );
}

function SearchResultCard({ venue }: { venue: VenueSearchResult }) {
  return (
    <div className="bg-surface border border-line rounded-card p-3.5 flex items-center gap-3">
      <div className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0">
        {venue.photo ? <img src={venue.photo} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <CategoryPlaceholder category={venue.category} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sm truncate">{venue.name}</div>
        <div className="text-faint text-xs truncate">
          {venue.area}
          {venue.distanceKm !== null && ` · ${venue.distanceKm} km away`}
        </div>
      </div>
      {venue.category ? (
        <span className="text-[10px] font-mono uppercase text-accent bg-accentDim rounded-full px-2 py-1 shrink-0">{venue.category}</span>
      ) : (
        <span className="text-[10px] font-mono uppercase text-faint bg-surface2 rounded-full px-2 py-1 shrink-0">uncategorized</span>
      )}
    </div>
  );
}

// "Don't see your spot? Add it" — the fallback for a real venue that
// exists but that Session B's OSM ingestion doesn't have yet. Cheap to
// submit; a moderator reviews before it's live (same trust boundary as
// the existing venue-claim flow).
function SubmitVenueLink({
  show,
  setShow,
  categories,
  prefillName = "",
  prefillCategory = "",
}: {
  show: boolean;
  setShow: (v: boolean) => void;
  categories: string[];
  prefillName?: string;
  prefillCategory?: string;
}) {
  const [name, setName] = useState(prefillName);
  const [area, setArea] = useState("");
  const [category, setCategory] = useState(prefillCategory || categories[0] || "");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !area.trim() || !category) return;
    setStatus("submitting");
    setError(null);
    try {
      const res = await submitVenue({ name: name.trim(), area: area.trim(), lat: null, lng: null, category, note });
      if (res.ok) {
        setStatus("done");
      } else {
        setStatus("error");
        setError(res.error ?? "Couldn't submit that.");
      }
    } catch {
      setStatus("error");
      setError("Can't reach the Bhookmark API.");
    }
  }

  if (!show) {
    return (
      <button onClick={() => setShow(true)} className="w-full bg-surface border border-dashed border-line rounded-xl py-3.5 text-sm font-medium text-accent">
        Don't see your spot? Add it
      </button>
    );
  }

  if (status === "done") {
    return (
      <div className="bg-accentDim border border-accent/30 rounded-xl px-4 py-4 text-sm text-accent">
        Thanks — sent for review. A moderator will check it before it appears for everyone.
      </div>
    );
  }

  return (
    <div className="bg-surface border border-line rounded-card p-4">
      <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-3">Add a real place</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Venue name — e.g. Nandan Coffee"
        className="w-full bg-surface2 border border-line rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-accent mb-2.5"
      />
      <input
        value={area}
        onChange={(e) => setArea(e.target.value)}
        placeholder="Area — e.g. Indiranagar"
        className="w-full bg-surface2 border border-line rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-accent mb-2.5"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="w-full bg-surface2 border border-line rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-accent mb-2.5"
      >
        {categories.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything else that helps (optional)"
        rows={2}
        className="w-full bg-surface2 border border-line rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-accent mb-3 resize-none"
      />
      {error && <p className="text-bad text-xs mb-2">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => setShow(false)} className="flex-1 bg-surface2 rounded-lg py-2.5 text-sm font-medium text-muted">Cancel</button>
        <button
          onClick={submit}
          disabled={status === "submitting" || !name.trim() || !area.trim()}
          className="flex-1 bg-accent text-accentInk rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {status === "submitting" ? "Submitting…" : "Submit"}
        </button>
      </div>
    </div>
  );
}
