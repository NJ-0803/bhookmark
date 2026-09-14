import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { RemoteLog, VenueClaim } from "../api";
import { claimVenue, clearSession, currentDeviceId, getDietProfile, getMyVenueClaims, getSession, listSessions, revokeSession, setDietProfile } from "../api";
import { signatureCraving } from "../evidenceThresholds";
import { findDishPhoto } from "../data/dishes";
import { LIQUID_SPRING } from "../motion";
import { getThemePref, setThemePref, type ThemePref } from "../theme";
import PassportCard from "../components/PassportCard";
import BottomSheet from "../components/BottomSheet";
import FlavorDnaCard from "../components/FlavorDnaCard";
import TasteGameCard from "../components/TasteGameCard";
import CategoryArt from "../components/CategoryArt";

function fadeUp(delay: number) {
  return { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { ...LIQUID_SPRING, delay } };
}

// Masked by default — a full phone number sitting in plain view reads as
// a privacy slip, not a polished product. Reveals only on an explicit tap.
function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 4) return phone;
  const last2 = digits.slice(-2);
  const cc = phone.trim().startsWith("+") ? phone.trim().slice(0, 3) : "";
  return `${cc} •••• ••${last2}`.trim();
}

interface SessionRow {
  deviceId: string;
  label: string;
  createdAt: number;
  lastSeenAt: number;
  revoked: boolean;
}

const DIET_OPTIONS = [
  { id: "no-restriction", label: "No restriction" },
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "jain", label: "Jain" },
  { id: "eggetarian", label: "Eggetarian" },
];
const ALLERGEN_OPTIONS = ["dairy", "gluten", "nuts"];

const THEME_OPTIONS: { id: ThemePref; label: string; sub: string }[] = [
  { id: "evening", label: "Evening", sub: "Warm graphite with ivory text" },
  { id: "daylight", label: "Daylight", sub: "Ivory paper with ink text" },
  { id: "system", label: "Match device", sub: "Follows your phone's light or dark setting" },
];

type Sheet = "dietary" | "appearance" | "claim" | "sessions" | null;

export default function Profile({
  logs,
  onSignOut,
  onLogFirst,
}: {
  logs: RemoteLog[];
  onSignOut: () => void;
  onLogFirst: () => void;
}) {
  const visibleLogs = logs.filter((l) => l.status !== "removed");
  const verifiedCount = visibleLogs.filter((l) => l.verified).length;
  const verifiedPct = visibleLogs.length ? Math.round((verifiedCount / visibleLogs.length) * 100) : 0;
  const session = getSession();
  // No display names exist on accounts; the email's local part is the most
  // personal real value available (never a hardcoded name).
  const displayName = session?.user.email?.split("@")[0] ?? "Your passport";

  // Everything below derives from the person's real logs. Signature craving
  // is evidence-gated — it never claims a pattern from a single log.
  const cravingResult = signatureCraving(visibleLogs);
  const contrarian = visibleLogs.find((l) => l.verdict === "loved" && l.score < 8.0);
  const repeatOrders = visibleLogs.filter((l) => l.verdict === "loved").length;

  const [sheet, setSheet] = useState<Sheet>(null);
  const [phoneRevealed, setPhoneRevealed] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [diet, setDiet] = useState("no-restriction");
  const [allergens, setAllergens] = useState<string[]>([]);
  const [dietSaved, setDietSaved] = useState(false);
  const [themePref, setThemePrefState] = useState<ThemePref>(getThemePref);
  const [claimVenueName, setClaimVenueName] = useState("");
  const [claims, setClaims] = useState<VenueClaim[]>([]);
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    getDietProfile().then((res) => {
      if (res.ok) {
        setDiet(res.dietaryProfile);
        setAllergens(res.allergens);
      }
    });
  }, []);

  useEffect(() => {
    if (sheet !== "claim") return;
    getMyVenueClaims().then((res) => res.ok && setClaims(res.claims));
  }, [sheet]);

  async function submitClaim() {
    if (!claimVenueName.trim()) return;
    setClaimSubmitting(true);
    setClaimError(null);
    const res = await claimVenue(claimVenueName.trim());
    setClaimSubmitting(false);
    if (res.ok) {
      setClaimVenueName("");
      getMyVenueClaims().then((r) => r.ok && setClaims(r.claims));
    } else {
      setClaimError(res.error ?? "Couldn't submit that claim.");
    }
  }

  async function saveDiet(nextDiet: string, nextAllergens: string[]) {
    setDiet(nextDiet);
    setAllergens(nextAllergens);
    const res = await setDietProfile(nextDiet, nextAllergens);
    if (res.ok) {
      setDietSaved(true);
      setTimeout(() => setDietSaved(false), 1200);
    }
  }

  function toggleAllergen(a: string) {
    const next = allergens.includes(a) ? allergens.filter((x) => x !== a) : [...allergens, a];
    saveDiet(diet, next);
  }

  function chooseTheme(pref: ThemePref) {
    setThemePref(pref);
    setThemePrefState(pref);
  }

  useEffect(() => {
    if (sheet !== "sessions") return;
    listSessions()
      .then((res) => (res.ok ? setSessions(res.sessions) : setSessionsError(res.error ?? "Couldn't load sessions.")))
      .catch(() => setSessionsError("Can't reach the Bhookmark API."));
  }, [sheet]);

  async function handleRevoke(deviceId: string) {
    const res = await revokeSession(deviceId);
    if (res.ok) setSessions((prev) => prev.map((s) => (s.deviceId === deviceId ? { ...s, revoked: true } : s)));
  }

  const phone = session?.user.phone ?? null;

  return (
    <div className="px-5 pt-8 pb-32">
      <PassportCard
        name={displayName}
        city={phone ? `${phoneRevealed ? phone : maskPhone(phone)} · Bangalore` : "Bangalore"}
        dishesLogged={visibleLogs.length}
        verifiedPct={verifiedPct}
        repeatCount={repeatOrders}
        cravingCategory={cravingResult.tier === "unlocked" ? cravingResult.category : null}
        onLogFirst={onLogFirst}
      />
      {phone && (
        <button onClick={() => setPhoneRevealed((v) => !v)} className="text-muted text-[13px] underline underline-offset-2 mb-4 h-8">
          {phoneRevealed ? "Hide number" : "Show full number"}
        </button>
      )}

      <motion.div {...fadeUp(0.08)} className="mb-3 mt-2">
        <FlavorDnaCard logs={visibleLogs} />
      </motion.div>

      <motion.div {...fadeUp(0.1)} className="mb-3">
        <TasteGameCard logCount={visibleLogs.length} />
      </motion.div>

      {visibleLogs.length > 0 && (
        <motion.section {...fadeUp(0.12)} aria-labelledby="recent-bites" className="mb-3">
          <h2 id="recent-bites" className="text-[16px] font-medium text-ink mb-2.5 mt-5">
            Recent bites
          </h2>
          <div className="flex gap-3 overflow-x-auto -mx-5 px-5 pb-1" style={{ scrollbarWidth: "none" }}>
            {visibleLogs.slice(0, 8).map((log) => {
              const photo = log.photoUrl ?? findDishPhoto(log.category, log.subtype, log.name, log.venue);
              return (
                <div key={log.id} className="shrink-0 w-32">
                  <div className="relative aspect-square rounded-2xl overflow-hidden border border-line bg-surface2">
                    {photo ? <img src={photo} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" /> : <CategoryArt category={log.category} compact />}
                  </div>
                  <span className="dish-name text-[16px] text-ink line-clamp-2 mt-2">{log.name}</span>
                  <span className="block text-muted text-[12px] mt-0.5">{timeAgo(log.createdAt)}</span>
                </div>
              );
            })}
          </div>
        </motion.section>
      )}

      {contrarian && (
        <motion.section {...fadeUp(0.16)} className="bg-surface border border-line rounded-card p-4 mb-3">
          <h2 className="text-[16px] font-medium text-ink mb-1">Loved it anyway</h2>
          <p className="text-[14px] text-muted leading-snug">
            You loved <span className="text-ink">{contrarian.name}</span> but gave it {contrarian.score.toFixed(1)} — your verdict and your number
            don't always agree, and that's worth knowing.
          </p>
        </motion.section>
      )}

      <motion.section {...fadeUp(0.2)} aria-labelledby="settings" className="mt-6 mb-6">
        <h2 id="settings" className="text-[16px] font-medium text-ink mb-2.5">
          Account &amp; settings
        </h2>
        <div className="bg-surface border border-line rounded-card overflow-hidden">
          {([
            ["dietary", "Dietary profile & allergens"],
            ["appearance", "Appearance"],
            ["claim", "Run a restaurant?"],
            ["sessions", "Devices & sessions"],
          ] as const).map(([id, label]) => (
            <button key={id} onClick={() => setSheet(id)} className="w-full flex items-center justify-between px-4 h-14 border-b border-line text-left">
              <span className="text-[15px] text-ink">{label}</span>
              <span className="flex items-center gap-2 text-muted text-[14px]">
                {id === "appearance" && THEME_OPTIONS.find((t) => t.id === themePref)?.label}
                <span className="text-faint" aria-hidden="true">
                  ›
                </span>
              </span>
            </button>
          ))}
          <p className="text-muted text-[13px] px-4 pt-3.5 pb-2 leading-snug">
            Your exact location is never shown publicly — it's only used to confirm a verified log at the moment you make it.
          </p>
          <button
            onClick={() => {
              clearSession();
              onSignOut();
            }}
            className="w-full text-bad text-[15px] font-medium h-12"
          >
            Sign out
          </button>
        </div>
      </motion.section>

      <BottomSheet open={sheet === "appearance"} onClose={() => setSheet(null)} title="Appearance">
        <div role="radiogroup" aria-label="Theme" className="flex flex-col gap-2">
          {THEME_OPTIONS.map((t) => {
            const active = themePref === t.id;
            return (
              <button
                key={t.id}
                role="radio"
                aria-checked={active}
                onClick={() => chooseTheme(t.id)}
                className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 border text-left ${active ? "border-rose bg-accentDim" : "border-line bg-surface2"}`}
              >
                <span>
                  <span className="block text-[15px] text-ink">{t.label}</span>
                  <span className="block text-[13px] text-muted">{t.sub}</span>
                </span>
                <span className={`w-5 h-5 rounded-full border-2 shrink-0 ${active ? "border-rose bg-rose" : "border-line"}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "dietary"} onClose={() => setSheet(null)} title="Dietary profile & allergens">
        <div className="flex items-center justify-between mb-2">{dietSaved && <span className="text-rose text-[13px]">Saved</span>}</div>
        <p className="text-muted text-[14px] mb-3">Filters search, dish warnings, and recommendations across the whole app — set once instead of every search.</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {DIET_OPTIONS.map((d) => (
            <button
              key={d.id}
              onClick={() => saveDiet(d.id, allergens)}
              className={`text-[14px] px-3.5 h-10 rounded-full border ${diet === d.id ? "bg-accent text-accentInk border-accent" : "bg-surface2 border-line text-ink"}`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <p className="text-[14px] font-medium text-ink mb-2">Allergens to avoid</p>
        <div className="flex gap-2">
          {ALLERGEN_OPTIONS.map((a) => (
            <button
              key={a}
              onClick={() => toggleAllergen(a)}
              className={`text-[14px] px-3.5 h-10 rounded-full border ${allergens.includes(a) ? "bg-badDim text-bad border-bad/40" : "bg-surface2 border-line text-ink"}`}
            >
              {a}
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "claim"} onClose={() => setSheet(null)} title="Run a restaurant?">
        <p className="text-muted text-[14px] mb-3">
          Claim your venue so your own logs there are disclosed and never count toward its public score — Bhookmark never lets a restaurant quietly
          rate itself.
        </p>
        <div className="flex gap-2 mb-2">
          <input
            value={claimVenueName}
            onChange={(e) => setClaimVenueName(e.target.value)}
            placeholder="Exact venue name, e.g. Truffles"
            aria-label="Venue name"
            className="flex-1 min-w-0 bg-surface2 border border-line rounded-xl px-3.5 h-11 text-[16px] outline-none focus:border-rose"
          />
          <button
            onClick={submitClaim}
            disabled={claimSubmitting || !claimVenueName.trim()}
            className="bg-accent text-accentInk font-medium rounded-xl px-4 text-[15px] disabled:opacity-40"
          >
            Claim
          </button>
        </div>
        {claimError && <p className="text-bad text-[13px] mb-2">{claimError}</p>}
        <p className="text-muted text-[13px] mb-3">A moderator reviews every claim manually before it takes effect.</p>
        {claims.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {claims.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-surface2 rounded-xl px-3 py-2.5">
                <span className="text-[14px] truncate">{c.venue}</span>
                <span
                  className={`text-[12px] px-2 py-0.5 rounded-full shrink-0 ${
                    c.status === "approved" ? "bg-accentDim text-rose" : c.status === "rejected" ? "bg-badDim text-bad" : "bg-surface text-muted"
                  }`}
                >
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={sheet === "sessions"} onClose={() => setSheet(null)} title="Devices & sessions">
        <div className="flex flex-col gap-2">
          {sessionsError && <p className="text-bad text-[14px] px-1">{sessionsError}</p>}
          {sessions.map((s) => (
            <div key={s.deviceId} className="bg-surface2 border border-line rounded-xl p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium truncate">
                  {s.label} {s.deviceId === currentDeviceId() && <span className="text-rose text-[13px]">· this device</span>}
                </div>
                <div className="text-muted text-[13px] mt-0.5">last active {timeAgo(s.lastSeenAt)}</div>
              </div>
              {s.revoked ? (
                <span className="text-muted text-[13px] shrink-0">revoked</span>
              ) : (
                <button onClick={() => handleRevoke(s.deviceId)} className="text-bad text-[13px] font-medium shrink-0 h-10 px-2">
                  Sign out
                </button>
              )}
            </div>
          ))}
        </div>
      </BottomSheet>
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
