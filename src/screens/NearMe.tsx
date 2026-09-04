import { useState } from "react";
import { motion } from "framer-motion";
import { CATEGORIES } from "../data/dishes";
import type { Category } from "../types";
import { getNearbyVenues, type NearbyVenue } from "../api";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";

type Stage =
  | { name: "pick" }
  | { name: "locating" }
  | { name: "results"; venues: NearbyVenue[]; category: Category }
  | { name: "error"; message: string };

export default function NearMe({ onBack }: { onBack: () => void }) {
  const [category, setCategory] = useState<Category>("Burger");
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const [radiusKm, setRadiusKm] = useState(5);

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
          setStage({ name: "results", venues: res.results, category });
        } catch {
          setStage({ name: "error", message: "Can't reach the Bhookmark API — is the backend running on :4001?" });
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

  return (
    <div className="px-5 pt-6 pb-32">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} aria-label="Back" className="w-11 h-11 rounded-full bg-surface border border-line flex items-center justify-center text-muted">‹</button>
        <h1 className="font-display font-semibold text-lg">Near me</h1>
      </div>

      {stage.name === "pick" && (
        <>
          <p className="text-muted text-sm mb-6">Pick a craving, share your location for a moment, and see every joint serving it nearby — ranked, with real reviews from Bhookmark members.</p>

          <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-3">Craving</p>
          <div className="grid grid-cols-2 gap-2.5 mb-6">
            {CATEGORIES.map((c) => (
              <motion.button
                key={c.name}
                onClick={() => setCategory(c.name)}
                whileTap={TAP_SCALE}
                transition={LIQUID_SPRING}
                className={`flex items-center gap-2.5 rounded-xl px-3.5 py-3 border text-left ${
                  category === c.name ? "bg-accent border-accent text-accentInk" : "bg-surface border-line"
                }`}
              >
                <span className="text-lg">{c.emoji}</span>
                <span className="font-medium text-sm">{c.name}</span>
              </motion.button>
            ))}
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
            <p className="text-muted text-sm">Nothing serving {stage.category.toLowerCase()} within {radiusKm}km yet — try widening the radius.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {stage.venues.map((v, i) => (
                <VenueCard key={v.id} venue={v} index={i} />
              ))}
            </div>
          )}
          <button onClick={() => setStage({ name: "pick" })} className="w-full mt-5 bg-surface border border-line rounded-xl py-3 text-sm font-medium text-muted">
            Search a different craving
          </button>
        </>
      )}
    </div>
  );
}

function VenueCard({ venue, index }: { venue: NearbyVenue; index: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...LIQUID_SPRING, delay: index * 0.05 }}
      className="bg-surface border border-line rounded-card overflow-hidden"
    >
      <div className="relative aspect-[16/9]">
        <img src={venue.photo} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
          <div>
            <div className="font-display font-bold text-white text-base leading-tight">{venue.name}</div>
            <div className="text-white/70 text-xs mt-0.5">{venue.area} · {venue.distanceKm} km away</div>
          </div>
          <span className="font-mono text-sm font-semibold text-accent bg-black/50 rounded-md px-2 py-1 tabular">{venue.rating.toFixed(1)}</span>
        </div>
        {!venue.photoIsVerified && (
          <span className="absolute top-2 right-2 text-[9px] font-mono uppercase tracking-wide text-white/70 bg-black/50 rounded px-1.5 py-0.5">representative photo</span>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">{venue.dishName}</span>
          <span className="text-[10px] font-mono uppercase text-faint">
            {venue.ratingSource === "community" ? `${venue.reviewCount} Bhookmark review${venue.reviewCount === 1 ? "" : "s"}` : "starting score"}
          </span>
        </div>

        {venue.reviews.length > 0 ? (
          <>
            <button onClick={() => setExpanded((v) => !v)} className="text-accent text-xs font-medium">
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
          <p className="text-faint text-xs">No Bhookmark reviews yet — be the first to log this one.</p>
        )}
      </div>
    </motion.div>
  );
}
