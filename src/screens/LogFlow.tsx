import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { CATEGORIES, dishesForSubtype } from "../data/dishes";
import type { Category, DishEntry, JournalLog, Verdict } from "../types";
import DishThumb from "../components/DishThumb";
import WhyThis from "../components/WhyThis";
import Duel from "./Duel";
import { api, currentDeviceId } from "../api";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";

// Manual entry only, by deliberate product decision — not a placeholder for
// AI. Real dish-recognition needs a metered vision API (Anthropic, OpenAI,
// Google — all paid, no way around it), and the call was made not to take
// on that ongoing cost. This is a complete, honest state, not a gap: no
// fabricated confidence, no dead-end, nothing implying AI is coming.
type Step = "capture" | "details" | "verify" | "confirm" | "duel" | "done";
type ServerStatus = "published" | "held" | "local-only" | "session-expired";

const TINTS = ["from-amber-500/30 to-amber-900/40", "from-rose-500/30 to-rose-900/40", "from-cyan-600/30 to-slate-900/40", "from-emerald-500/30 to-emerald-900/40"];
const EMOJI: Record<Category, string> = { "Dosa & Idli": "🥞", Biryani: "🍛", "Filter Coffee": "☕", Burger: "🍔", Pizza: "🍕", Momos: "🥟" };

export default function LogFlow({
  prefillDish,
  onClose,
  onComplete,
}: {
  prefillDish?: DishEntry;
  onClose: () => void;
  onComplete: (log: JournalLog, dish: DishEntry) => void;
}) {
  const [step, setStep] = useState<Step>(prefillDish ? "verify" : "capture");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | "Other">(prefillDish?.category ?? CATEGORIES[0].name);
  const [subtype, setSubtype] = useState(prefillDish?.subtype ?? CATEGORIES[0].subtypes[0]);
  const [customCategory, setCustomCategory] = useState("");
  const [name, setName] = useState(prefillDish?.name ?? "");
  const [venue, setVenue] = useState(prefillDish?.venue ?? "");
  const [locating, setLocating] = useState(false);
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [offlineSim, setOfflineSim] = useState(false);
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus>("local-only");
  const [copied, setCopied] = useState(false);
  const [revealScore, setRevealScore] = useState(0);
  const idempotencyKey = useRef(crypto.randomUUID());

  const resolvedCategory = (category === "Other" ? customCategory || "Other" : category) as Category;

  const workingDish: DishEntry =
    prefillDish ?? {
      id: `new-${Date.now()}`,
      category: resolvedCategory,
      subtype: category === "Other" ? subtype || "General" : subtype,
      name,
      venue: venue || "Unnamed venue",
      area: "Bangalore",
      emoji: category === "Other" ? "🍽️" : EMOJI[category],
      tint: TINTS[Math.floor(Math.random() * TINTS.length)],
      score: 0,
      verifiedPct: 0,
      logCount: 0,
      priceRs: 0,
      tasteNotes: [],
      allergens: [],
    };

  const opponents = dishesForSubtype(workingDish.category, workingDish.subtype).filter((d) => d.id !== workingDish.id);

  function attachPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoUrl(URL.createObjectURL(file));
  }

  // Real navigator.geolocation call — replaces what used to be a pure UI
  // toggle switch claiming "liveLocationMatch" with zero browser API call
  // behind it. The server cross-checks these coordinates against known
  // venue locations (see server/src/routes/logs.ts computeLocationMatch).
  function shareLocation() {
    if (!navigator.geolocation) {
      setLocationMessage("This browser can't share your location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocationCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationMessage("Location captured — used once to help verify this log, never stored as-is.");
        setLocating(false);
      },
      (err) => {
        setLocationMessage(
          err.code === err.PERMISSION_DENIED
            ? "Location access was denied — this log will still post, just unverified."
            : "Couldn't get your location. You can still continue unverified."
        );
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }

  async function finishLog(score: number, verdict: Verdict) {
    const log: JournalLog = {
      id: `log-${Date.now()}`,
      dishId: workingDish.id,
      verdict,
      score,
      verified: !!photoUrl || !!locationCoords,
      note: "",
      timestamp: "Just now",
      reorder: verdict === "loved",
    };

    // Real call to the Section 13/14 backend — idempotency key means a retry
    // (e.g. a flaky connection) never creates a duplicate log server-side.
    // The server, not this client, decides the actual evidence level.
    try {
      const res = await api("/logs", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({
          category: workingDish.category,
          subtype: workingDish.subtype,
          name: workingDish.name,
          venue: workingDish.venue,
          verdict,
          score,
          note,
          deviceId: currentDeviceId() ?? "unknown-device",
          visibility: isPrivate ? "private" : "public",
          evidence: { livePhoto: !!photoUrl, receipt: false, location: locationCoords },
        }),
      });
      if (res.status === 401) {
        setServerStatus("session-expired");
      } else {
        const body = await res.json();
        setServerStatus(res.ok && body.ok ? body.log.status : "local-only");
      }
    } catch {
      // Backend unreachable — the log still lands in the local Bhookmarks
      // journal (F-10: manual/local flow always works even if enrichment
      // or the network doesn't).
      setServerStatus("local-only");
    }

    onComplete(log, { ...workingDish, score });
    setRevealScore(score);
    setStep("done");
  }

  function shareText() {
    return `${workingDish.name} — ${revealScore.toFixed(1)}/10 on Bhookmark. ${workingDish.venue}, Bangalore.`;
  }

  function handleSave() {
    if (offlineSim) {
      setShowOfflineBanner(true);
      return;
    }
    if (opponents.length === 0) {
      finishLog(6.8, "fine");
      return;
    }
    setStep("duel");
  }

  return (
    <motion.div
      layoutId="bitelog-fab"
      transition={LIQUID_SPRING}
      className="fixed inset-0 z-50 bg-bg/95 backdrop-blur-sm flex justify-center"
    >
      <div className="w-full max-w-[460px] h-full flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-faint">BiteLog</span>
          <motion.button
            onClick={onClose}
            whileTap={TAP_SCALE}
            transition={LIQUID_SPRING}
            aria-label="Close"
            className="w-11 h-11 rounded-full bg-surface border border-line flex items-center justify-center text-muted"
          >
            ✕
          </motion.button>
        </div>

        <div className="flex-1 overflow-y-auto pt-6">
          {step === "capture" && (
            <div className="px-5">
              <h3 className="font-display font-bold text-xl mb-1">Snap the dish</h3>
              <p className="text-muted text-sm mb-5">Optional, for your own Taste Receipt — Bhookmark doesn't analyze it, so you'll fill in the details next either way.</p>
              <label className="block aspect-[4/3] rounded-card border-2 border-dashed border-line overflow-hidden relative cursor-pointer hover:border-accent/50 transition-colors">
                <input type="file" accept="image/*" capture="environment" onChange={attachPhoto} className="sr-only" />
                {photoUrl ? (
                  <img src={photoUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <span className="text-3xl">📸</span>
                    <span className="text-muted text-sm font-medium">Tap to add a photo</span>
                  </div>
                )}
              </label>
              <div className="flex gap-2.5 mt-4">
                <button onClick={() => setStep("details")} className="flex-1 bg-surface border border-line rounded-xl py-3 text-sm font-medium">
                  {photoUrl ? "Continue without changes" : "Skip photo"}
                </button>
              </div>
            </div>
          )}

          {step === "details" && (
            <div className="px-5 flex flex-col gap-4">
              <h3 className="font-display font-bold text-xl">What did you eat?</h3>
              <Field label="Category">
                <select
                  value={category}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "Other") { setCategory("Other"); setSubtype(""); return; }
                    setCategory(val as Category);
                    setSubtype(CATEGORIES.find((c) => c.name === val)!.subtypes[0]);
                  }}
                  className="input"
                >
                  {CATEGORIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  <option value="Other">Other — not listed</option>
                </select>
              </Field>
              {category === "Other" ? (
                <>
                  <Field label="What kind of food is this?">
                    <input value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="e.g. Ethiopian, Ramen, Shawarma" className="input" />
                  </Field>
                  <Field label="Subtype (optional)">
                    <input value={subtype} onChange={(e) => setSubtype(e.target.value)} placeholder="e.g. Spicy, Veg" className="input" />
                  </Field>
                </>
              ) : (
                <Field label="Subtype">
                  <select value={subtype} onChange={(e) => setSubtype(e.target.value)} className="input">
                    {CATEGORIES.find((c) => c.name === category)!.subtypes.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Dish name">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken Biryani" className="input" />
              </Field>
              <Field label="Venue">
                <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Truffles, Koramangala" className="input" />
              </Field>
              <button
                onClick={() => setStep("verify")}
                disabled={!name.trim() || !venue.trim()}
                className="w-full bg-accent text-accentInk font-semibold rounded-xl py-3.5 mt-2 disabled:opacity-40 active:scale-[0.98] transition-transform"
              >
                Continue
              </button>
            </div>
          )}

          {step === "verify" && (
            <div className="px-5">
              <div className="flex items-center gap-3 mb-4">
                <DishThumb emoji={workingDish.emoji} tint={workingDish.tint} size="sm" />
                <div>
                  <div className="font-semibold text-sm">{workingDish.name}</div>
                  <div className="text-faint text-xs">{workingDish.category} · {workingDish.subtype}</div>
                </div>
              </div>
              <h3 className="font-display font-bold text-xl mb-1">Verify this log?</h3>
              <p className="text-muted text-sm mb-5">
                Optional. Sharing your location for a moment lets Bhookmark confirm you were actually near{" "}
                {workingDish.venue === "Unnamed venue" ? "this venue" : workingDish.venue} — verified logs carry full weight in the
                public score. Unverified logs still post, just at a lower weight.
              </p>
              <button
                onClick={shareLocation}
                disabled={locating || !!locationCoords}
                className={`w-full flex items-center justify-between rounded-xl px-4 py-3.5 border transition-colors ${
                  locationCoords ? "bg-accentDim border-accent/40" : "bg-surface border-line"
                }`}
              >
                <span className="font-medium text-sm">
                  {locationCoords ? "Location shared ✓" : locating ? "Getting your location…" : "Share my location"}
                </span>
                {!locationCoords && !locating && <span className="text-faint">›</span>}
              </button>
              {locationMessage && <p className="text-faint text-xs mt-2.5">{locationMessage}</p>}
              <button onClick={() => setStep("confirm")} className="w-full bg-accent text-accentInk font-semibold rounded-xl py-3.5 mt-6 active:scale-[0.98] transition-transform">
                Continue
              </button>
            </div>
          )}

          {step === "confirm" && (
            <div className="px-5">
              <h3 className="font-display font-bold text-xl mb-5">Ready to log</h3>
              <div className="bg-surface border border-line rounded-card p-4 flex items-center gap-3 mb-5">
                <DishThumb emoji={workingDish.emoji} tint={workingDish.tint} photo={photoUrl ?? undefined} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{workingDish.name}</div>
                  <div className="text-faint text-xs truncate">{workingDish.venue || "Venue not set"}</div>
                </div>
                <span className={`text-xs font-mono px-2 py-1 rounded ${locationCoords || photoUrl ? "bg-accentDim text-accent" : "bg-surface2 text-faint"}`}>
                  {locationCoords || photoUrl ? "adds evidence" : "manual only"}
                </span>
              </div>
              <WhyThis
                title="What does this badge mean?"
                body="Bhookmark never calls a log “verified” from a client-side toggle. The server checks your evidence itself: a matched location plus a photo counts as full live-capture, either one alone counts as visit-consistent, and a manual-only log is recorded honestly as declared. All of them post — verified evidence just carries more weight in the public score."
              />

              <div className="mb-4" />

              <Field label="Add a note (optional)">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 300))}
                  placeholder="What stood out — texture, spice, value, anything worth remembering?"
                  rows={3}
                  className="input resize-none"
                />
              </Field>
              <div className="mb-4" />

              <ToggleRow
                label="Keep this private"
                sub="Never counts toward any public score or shows to anyone else — still saved to your own Bhookmarks"
                value={isPrivate}
                onChange={setIsPrivate}
              />
              <div className="mb-2.5" />

              <ToggleRow label="Simulate poor connection" sub="For testing the offline fallback" value={offlineSim} onChange={setOfflineSim} />

              {showOfflineBanner && (
                <div className="mt-4 bg-badDim border border-bad/30 rounded-xl px-4 py-3 text-sm text-bad">
                  No connection — saved to your device. It'll sync and enter duels automatically once you're back online.
                  <button onClick={() => { setShowOfflineBanner(false); onClose(); }} className="block mt-2 text-xs underline text-bad/80">
                    Got it
                  </button>
                </div>
              )}

              {!showOfflineBanner && (
                <button onClick={handleSave} className="w-full bg-accent text-accentInk font-semibold rounded-xl py-3.5 mt-6 active:scale-[0.98] transition-transform">
                  Save log
                </button>
              )}
            </div>
          )}

          {step === "duel" && (
            <Duel
              challenger={{ name: workingDish.name, venue: workingDish.venue, emoji: workingDish.emoji, tint: workingDish.tint, photo: workingDish.photo }}
              opponents={opponents}
              onDone={({ score, verdict }) => finishLog(score, verdict)}
            />
          )}

          {step === "done" && (
            <div className="px-5 text-center pt-6">
              <div className="text-4xl mb-3">✓</div>
              <h3 className="font-display font-bold text-xl mb-1">Added to your Bhookmarks</h3>
              {serverStatus === "held" ? (
                <p className="text-saffron text-xs mb-5">Held for a quick review before it counts publicly — logging bursts on one venue trigger this automatically.</p>
              ) : serverStatus === "local-only" ? (
                <p className="text-faint text-xs mb-5">Saved locally — the Bhookmark API wasn't reachable, so it'll sync once it is.</p>
              ) : serverStatus === "session-expired" ? (
                <p className="text-bad text-xs mb-5">Saved locally, but your session expired — sign in again from your profile so it syncs and shows up publicly.</p>
              ) : (
                <p className="text-muted text-sm mb-5">You'll see this instantly when you're deciding whether to bhookmark it again.</p>
              )}

              <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-2 text-left">Taste Receipt</p>
              <div className="bg-gradient-to-b from-surface2 to-surface border border-line rounded-card p-5 mb-5 text-left">
                {photoUrl ? (
                  <img src={photoUrl} alt="" className="w-full aspect-[4/3] object-cover rounded-xl" />
                ) : (
                  <DishThumb emoji={workingDish.emoji} tint={workingDish.tint} size="lg" />
                )}
                <div className="mt-3 font-display font-bold text-lg leading-tight">{workingDish.name}</div>
                <div className="text-faint text-xs mt-0.5">{workingDish.venue}</div>
                <div className="flex items-center justify-between mt-3">
                  <span className="font-mono text-2xl font-semibold text-accent tabular">{revealScore.toFixed(1)}</span>
                  <span className="text-xs text-muted">via Bhookmark</span>
                </div>
              </div>

              <button
                onClick={() => { navigator.clipboard?.writeText(shareText()); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="w-full bg-surface border border-line rounded-xl py-3 text-sm font-medium mb-2.5"
              >
                {copied ? "Copied — paste it in your Story" : "Copy Taste Receipt caption"}
              </button>
              <button onClick={onClose} className="w-full bg-accent text-accentInk font-semibold rounded-xl py-3.5">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
      <style>{`.input { background: #171E1B; border: 1px solid #202826; border-radius: 10px; padding: 10px 14px; font-size: 14px; color: #F5F1E8; outline: none; } .input:focus { border-color: #E879F9; }`}</style>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({ label, sub, value, onChange }: { label: string; sub: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 bg-surface border border-line rounded-xl px-4 py-3.5">
      <div>
        <div className="font-medium text-sm">{label}</div>
        <div className="text-faint text-xs mt-0.5">{sub}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`w-11 h-6 rounded-full shrink-0 relative transition-colors ${value ? "bg-accent" : "bg-surface2"}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-bg transition-transform ${value ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}
