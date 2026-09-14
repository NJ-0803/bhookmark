import { useState } from "react";
import { motion } from "framer-motion";
import type { RemoteLog } from "../api";
import { findDishPhoto } from "../data/dishes";
import { DepthLayer, FloatCard, FloatMedia } from "../components/CardStage";
import DishPanel from "../components/DishPanel";
import { CardSaveButton } from "../components/SaveButton";
import { savedToDishEntry, useSaves } from "../saves";
import { placeLine } from "../format";
import type { DishEntry } from "../types";
import { ratingVerdict } from "../components/RatingPicker";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";
import { VERDICT_COPY } from "../verdictCopy";
import { signatureCraving } from "../evidenceThresholds";

const REACTIONS = ["Ordering this", "Cap", "Take me"];

export default function Bhookmarks({
  logs,
  logsError,
  onLogFirst,
  onLogDish,
}: {
  logs: RemoteLog[] | null;
  logsError: string | null;
  onLogFirst: () => void;
  onLogDish: (dish: DishEntry) => void;
}) {
  const [previewEmpty, setPreviewEmpty] = useState(false);
  const visibleLogs = (logs ?? []).filter((l) => l.status !== "removed");
  const loading = logs === null && !logsError;
  const empty = previewEmpty || (!loading && visibleLogs.length === 0);
  const flavorNote = deriveFlavorNote(visibleLogs.filter((l) => l.verdict === "loved"));

  return (
    <div className="px-5 pt-8 pb-32">
      <div className="flex items-center justify-between mb-1">
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint">Your Bhookmarks</p>
        {!loading && (
          <button onClick={() => setPreviewEmpty((v) => !v)} className="text-[11px] font-mono text-faint underline underline-offset-2">
            {previewEmpty ? "show my journal" : "preview: new account"}
          </button>
        )}
      </div>
      <h1 className="font-display font-extrabold text-2xl mb-6 text-ink">Never forget a bite.</h1>

      {logsError && (
        <div className="bg-badDim border border-bad/30 rounded-xl px-4 py-3 text-sm text-bad mb-5">{logsError}</div>
      )}

      <SavedForLater onLogDish={onLogDish} />

      {loading ? (
        <div className="border border-line rounded-card px-6 py-10 text-center text-faint text-sm">Loading your Bhookmarks…</div>
      ) : empty ? (
        <div className="border border-dashed border-line rounded-card px-6 py-10 text-center">
          <h3 className="font-display font-semibold text-[18px] mb-1.5">Your Bhookmarks are embarrassingly empty</h3>
          <p className="text-muted text-sm mb-6 max-w-[28ch] mx-auto">
            Log your first bite and this becomes the fastest way to remember whether something's worth bhookmarking again.
          </p>
          <button onClick={onLogFirst} className="bg-accent text-accentInk font-semibold rounded-xl px-6 py-3 text-sm active:scale-[0.98] transition-transform">
            Fix that — log your first dish
          </button>
        </div>
      ) : (
        <>
          {flavorNote && (
            <div className="bg-surface border border-line rounded-card px-4 py-3.5 mb-5">
              <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-saffron mb-1">Flavor DNA</p>
              {flavorNote.kind === "note" ? (
                <p className="text-sm text-ink/90">{flavorNote.text}</p>
              ) : flavorNote.kind === "early" ? (
                <p className="text-sm text-ink/90">
                  <span className="text-saffron font-semibold">Early signal</span> — leaning toward{" "}
                  <span className="text-rose font-semibold">{flavorNote.category}</span>, based on {flavorNote.logsSeen} loved logs.
                  Not a real pattern yet.
                </p>
              ) : (
                <>
                  <p className="text-sm text-ink/90 mb-2">Log a few more loved dishes and a real pattern shows up here — not a guess from one good meal.</p>
                  <div className="w-full h-1.5 rounded-full bg-surface2 overflow-hidden mb-1.5">
                    <div className="h-full bg-accent" style={{ width: `${Math.min(100, (flavorNote.logsSeen / flavorNote.logsNeeded) * 100)}%` }} />
                  </div>
                  <p className="text-faint text-[11px]">
                    {flavorNote.logsSeen}/{flavorNote.logsNeeded} loved logs · {flavorNote.venuesSeen}/{flavorNote.venuesNeeded} venues
                  </p>
                </>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2.5">
            {visibleLogs.map((log, i) => {
              const photo = findDishPhoto(log.category, log.subtype, log.name, log.venue);
              const id = `log-${log.id}`;
              return (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ ...LIQUID_SPRING, delay: Math.min(i, 4) * 0.04 }}
                >
                  <FloatCard
                    id={id}
                    label={log.name}
                    radius={20}
                    wide
                    className="bg-surface border border-line"
                    contentClassName="flex gap-3 p-3"
                    panel={() => <LogPanel log={log} photo={photo} mediaId={`${id}-media`} />}
                  >
                    <FloatMedia id={`${id}-media`} photo={photo} category={log.category} className="w-20 h-20 shrink-0" radius={14} compact />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <span className="dish-name text-[19px] text-ink line-clamp-2">{log.name}</span>
                        <span className="font-mono text-[13px] text-ink/85 tabular shrink-0 mt-0.5">{log.score.toFixed(1)}</span>
                      </div>
                      <div className="text-muted text-[13px] truncate mt-1">
                        {log.venue} · {timeAgo(log.createdAt)}
                      </div>
                      {log.note && <p className="text-ink/75 text-[13px] mt-1 leading-snug line-clamp-2">"{log.note}"</p>}
                    </div>
                  </FloatCard>
                </motion.div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Dishes saved from any card, newest first. A card lifts into the full dish
 * panel, where it can be logged or unsaved. */
function SavedForLater({ onLogDish }: { onLogDish: (dish: DishEntry) => void }) {
  const { saves } = useSaves();
  if (saves.length === 0) return null;
  return (
    <section aria-labelledby="saved-for-later" className="mb-7">
      <h2 id="saved-for-later" className="text-[16px] font-medium text-ink mb-2.5">
        Saved for later <span className="text-muted font-normal">· {saves.length}</span>
      </h2>
      <div className="flex gap-3 overflow-x-auto -mx-5 px-5 pb-1" style={{ scrollbarWidth: "none" }}>
        {saves.map((s) => {
          const dish = savedToDishEntry(s);
          const id = `saved-${dish.id}`;
          return (
            <div key={dish.id} className="relative shrink-0 w-44">
              <FloatCard
                id={id}
                label={s.name}
                wide
                className="bg-surface border border-line"
                panel={() => <DishPanel dish={dish} mediaId={`${id}-media`} photo={dish.photo} userAllergens={[]} onLog={onLogDish} />}
              >
                <FloatMedia id={`${id}-media`} photo={dish.photo} category={s.category} className="aspect-square" />
                <div className="p-3">
                  <span className="dish-name text-[17px] text-ink line-clamp-2">{s.name}</span>
                  <span className="block text-muted text-[13px] mt-0.5 truncate">{placeLine(s)}</span>
                </div>
              </FloatCard>
              <CardSaveButton cardId={id} dish={s} className="absolute top-2 right-2 z-10" />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LogPanel({ log, photo, mediaId }: { log: RemoteLog; photo?: string; mediaId: string }) {
  const [reaction, setReaction] = useState("");
  return (
    <div className="lg:grid lg:grid-cols-2">
      <FloatMedia
        id={mediaId}
        photo={photo}
        category={log.category}
        className="aspect-[4/3] lg:aspect-auto lg:sticky lg:top-0 lg:self-start lg:h-[min(560px,calc(100dvh-48px))]"
        scrim
      />
      <div className="p-5 lg:p-7">
        <DepthLayer depth={6}>
          <p className="text-[13px] text-muted mb-1.5">
            {log.category} · {timeAgo(log.createdAt)}
          </p>
          <h2 className="dish-name text-[30px] text-ink lg:pr-12">{log.name}</h2>
          <p className="text-muted text-[15px] mt-2">{log.venue}</p>
        </DepthLayer>

        <DepthLayer depth={10} className="mt-6">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display font-light text-[44px] leading-none tracking-[-0.03em] tabular text-ink">{log.score.toFixed(1)}</span>
            <span className="text-faint text-sm">/ 10</span>
            {log.verified && <span className="ml-2 text-[10px] font-mono uppercase tracking-[0.14em] text-rose">verified</span>}
          </div>
          <p className="text-[13px] text-muted mt-2">{ratingVerdict(log.score).line}</p>
          {log.note && <p className="text-[14px] text-ink/90 leading-relaxed mt-4">"{log.note}"</p>}
        </DepthLayer>

        <DepthLayer depth={13} className="mt-5">
          <div className="flex flex-wrap gap-2">
            {log.verdict === "loved" && <Chip label="Running it back" tone="accent" />}
            <Chip label={VERDICT_COPY[log.verdict].label} tone={VERDICT_COPY[log.verdict].tone} />
            {log.status === "held" && <Chip label="Pending review" tone="warn" />}
            {log.ownerDisclosed && <Chip label="Restaurant representative" tone="warn" />}
            {log.visibility === "private" && <Chip label="Private" tone="neutral" />}
          </div>
          <div className="flex gap-2 mt-4">
            {REACTIONS.map((r) => (
              <motion.button
                key={r}
                whileTap={TAP_SCALE}
                transition={LIQUID_SPRING}
                onClick={() => setReaction((cur) => (cur === r ? "" : r))}
                className={`text-[13px] px-3.5 h-10 rounded-full border ${reaction === r ? "bg-accentDim border-accent text-ink" : "border-line text-muted"}`}
              >
                {r}
              </motion.button>
            ))}
          </div>
        </DepthLayer>
      </div>
    </div>
  );
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Chip({ label, tone }: { label: string; tone: "accent" | "neutral" | "warn" | "bad" }) {
  const toneClass =
    tone === "accent" ? "bg-accentDim text-rose" :
    tone === "warn" ? "bg-saffron/15 text-saffron" :
    tone === "bad" ? "bg-badDim text-bad" :
    "bg-surface2 text-muted";
  return <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${toneClass}`}>{label}</span>;
}

type FlavorNote =
  | { kind: "note"; text: string }
  | { kind: "early"; category: string; logsSeen: number }
  | { kind: "progress"; logsSeen: number; logsNeeded: number; venuesSeen: number; venuesNeeded: number };

// Evidence-gated (brief 1.1 + evidence table): "you consistently rank X
// highest" is a claim about a pattern, and a pattern isn't one good meal.
// Loved dishes only — the threshold applies to conviction, not frequency.
// Three tiers: nothing yet, an early hedged hint, or the full claim.
function deriveFlavorNote(loved: RemoteLog[]): FlavorNote | null {
  if (loved.length === 0) return null;
  const result = signatureCraving(loved);
  if (result.tier === "unlocked") {
    return {
      kind: "note",
      text: `You consistently rank ${result.category} highest when it's verified and eaten fresh off the counter — not delivered.`,
    };
  }
  if (result.tier === "early") {
    return { kind: "early", category: result.category, logsSeen: result.logsSeen };
  }
  return { kind: "progress", logsSeen: result.logsSeen, logsNeeded: result.logsNeeded, venuesSeen: result.venuesSeen, venuesNeeded: result.venuesNeeded };
}
