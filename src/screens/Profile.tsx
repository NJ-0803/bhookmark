import { useEffect, useState } from "react";
import type { RemoteLog, VenueClaim } from "../api";
import { claimVenue, clearSession, currentDeviceId, getDietProfile, getMyVenueClaims, getSession, listSessions, revokeSession, setDietProfile } from "../api";
import { signatureCraving } from "../evidenceThresholds";

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

export default function Profile({
  logs,
  onSignOut,
}: {
  logs: RemoteLog[];
  onSignOut: () => void;
}) {
  const visibleLogs = logs.filter((l) => l.status !== "removed");
  const verifiedCount = visibleLogs.filter((l) => l.verified).length;
  const verifiedPct = visibleLogs.length ? Math.round((verifiedCount / visibleLogs.length) * 100) : 0;
  const session = getSession();

  // Bhookmark Passport (Section 11): signature cravings, contrarian picks, repeat orders —
  // all derived from the real backend, the same source Home's recommenders read from.
  // Signature craving is evidence-gated (brief 1.1) — it never claims a pattern
  // from a single log, and shows real progress instead of nothing until it unlocks.
  const cravingResult = signatureCraving(visibleLogs);
  const contrarian = visibleLogs.find((l) => l.verdict === "loved" && l.score < 8.0);
  const repeatOrders = visibleLogs.filter((l) => l.verdict === "loved").length;

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [diet, setDiet] = useState("no-restriction");
  const [allergens, setAllergens] = useState<string[]>([]);
  const [dietSaved, setDietSaved] = useState(false);
  const [showClaim, setShowClaim] = useState(false);
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
    if (!showClaim) return;
    getMyVenueClaims().then((res) => res.ok && setClaims(res.claims));
  }, [showClaim]);

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

  useEffect(() => {
    if (!showSessions) return;
    listSessions()
      .then((res) => (res.ok ? setSessions(res.sessions) : setSessionsError(res.error ?? "Couldn't load sessions.")))
      .catch(() => setSessionsError("Can't reach the Bhookmark API."));
  }, [showSessions]);

  async function handleRevoke(deviceId: string) {
    const res = await revokeSession(deviceId);
    if (res.ok) setSessions((prev) => prev.map((s) => (s.deviceId === deviceId ? { ...s, revoked: true } : s)));
  }

  return (
    <div className="px-5 pt-8 pb-32">
      <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint mb-1">Bhookmark Passport</p>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-accent/40 to-accentDim border border-accent/40 flex items-center justify-center font-display font-bold text-lg">
          N
        </div>
        <div>
          <h1 className="font-display font-bold text-lg">Navtej</h1>
          <p className="text-faint text-xs">{session?.user.phone ?? "Koramangala"} · Bangalore</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5 mb-3">
        <Stat label="Dishes logged" value={String(visibleLogs.length)} />
        <Stat label="Verified" value={`${verifiedPct}%`} />
        <Stat label="Would bhookmark again" value={String(repeatOrders)} />
      </div>

      <div className="bg-surface border border-line rounded-card p-4 mb-3">
        <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-2">Signature craving</p>
        {cravingResult.tier === "unlocked" ? (
          <p className="text-sm text-ink/90">
            <span className="text-accent font-semibold">{cravingResult.category}</span> shows up more than anything else in your Bhookmarks
            {cravingResult.band === "strong" ? " — and it's a real, repeated pattern by now." : "."}
          </p>
        ) : cravingResult.tier === "early" ? (
          <p className="text-sm text-ink/90">
            <span className="text-gold font-semibold">Early signal</span> — you might be into{" "}
            <span className="text-accent font-semibold">{cravingResult.category}</span>, based on {cravingResult.logsSeen} logs so far.
            Not enough for a real pattern yet.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink/90 mb-2.5">Not enough evidence yet — a real pattern needs more than one lucky order.</p>
            <div className="w-full h-1.5 rounded-full bg-surface2 overflow-hidden mb-1.5">
              <div
                className="h-full bg-accent"
                style={{ width: `${Math.min(100, (cravingResult.logsSeen / cravingResult.logsNeeded) * 100)}%` }}
              />
            </div>
            <p className="text-faint text-[11px]">
              {cravingResult.logsSeen}/{cravingResult.logsNeeded} logs · {cravingResult.venuesSeen}/{cravingResult.venuesNeeded} venues in your top category
            </p>
          </>
        )}
      </div>

      {contrarian && (
        <div className="bg-surface border border-line rounded-card p-4 mb-3">
          <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-2">Contrarian pick</p>
          <p className="text-sm text-ink/90">
            You loved <span className="text-accent font-semibold">{contrarian.name}</span> even though the city
            ranks it below 8.0 — your taste and the crowd's don't always agree, and that's the point.
          </p>
        </div>
      )}

      <div className="bg-surface border border-line rounded-card p-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint">Dietary profile</p>
          {dietSaved && <span className="text-accent text-[11px]">saved</span>}
        </div>
        <p className="text-muted text-xs mb-3">Filters search, dish warnings, and recommendations across the whole app — set once instead of every search.</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {DIET_OPTIONS.map((d) => (
            <button
              key={d.id}
              onClick={() => saveDiet(d.id, allergens)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border ${
                diet === d.id ? "bg-accent text-accentInk border-accent" : "bg-surface2 border-line text-muted"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <p className="font-mono text-[10px] tracking-[0.08em] uppercase text-faint mb-2">Allergens to avoid</p>
        <div className="flex gap-2">
          {ALLERGEN_OPTIONS.map((a) => (
            <button
              key={a}
              onClick={() => toggleAllergen(a)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border ${
                allergens.includes(a) ? "bg-bad/20 text-bad border-bad/40" : "bg-surface2 border-line text-muted"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-surface border border-line rounded-card p-4 mb-3">
        <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-2">City leaderboard</p>
        <p className="text-sm text-ink/90">Ranked by dish diversity, not visit count — logging the same burger ten times won't move you up.</p>
      </div>

      <button
        onClick={() => setShowClaim((v) => !v)}
        className="w-full flex items-center justify-between bg-surface border border-line rounded-card p-4 mb-3"
      >
        <span className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint">Run a restaurant?</span>
        <span className="text-faint text-xs">{showClaim ? "hide" : "show"}</span>
      </button>

      {showClaim && (
        <div className="bg-surface border border-line rounded-card p-4 mb-3">
          <p className="text-muted text-xs mb-3">
            Claim your venue so your own logs there are disclosed and never count toward its public score — Bhookmark never lets a
            restaurant quietly rate itself.
          </p>
          <div className="flex gap-2 mb-2">
            <input
              value={claimVenueName}
              onChange={(e) => setClaimVenueName(e.target.value)}
              placeholder="Exact venue name, e.g. Truffles"
              className="flex-1 bg-surface2 border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={submitClaim}
              disabled={claimSubmitting || !claimVenueName.trim()}
              className="bg-accent text-accentInk font-semibold rounded-lg px-4 text-sm disabled:opacity-40"
            >
              Claim
            </button>
          </div>
          {claimError && <p className="text-bad text-xs mb-2">{claimError}</p>}
          <p className="text-faint text-[11px] mb-3">A moderator reviews every claim manually before it takes effect.</p>
          {claims.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {claims.map((c) => (
                <div key={c.id} className="flex items-center justify-between bg-surface2 rounded-lg px-3 py-2">
                  <span className="text-sm truncate">{c.venue}</span>
                  <span
                    className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full shrink-0 ${
                      c.status === "approved" ? "bg-accentDim text-accent" : c.status === "rejected" ? "bg-badDim text-bad" : "bg-surface text-faint"
                    }`}
                  >
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setShowSessions((v) => !v)}
        className="w-full flex items-center justify-between bg-surface border border-line rounded-card p-4 mb-3"
      >
        <span className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint">Devices &amp; sessions</span>
        <span className="text-faint text-xs">{showSessions ? "hide" : "show"}</span>
      </button>

      {showSessions && (
        <div className="flex flex-col gap-2 mb-3">
          {sessionsError && <p className="text-bad text-sm px-1">{sessionsError}</p>}
          {sessions.map((s) => (
            <div key={s.deviceId} className="bg-surface border border-line rounded-xl p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {s.label} {s.deviceId === currentDeviceId() && <span className="text-accent text-xs">· this device</span>}
                </div>
                <div className="text-faint text-xs mt-0.5">last active {timeAgo(s.lastSeenAt)}</div>
              </div>
              {s.revoked ? (
                <span className="text-faint text-xs shrink-0">revoked</span>
              ) : (
                <button onClick={() => handleRevoke(s.deviceId)} className="text-bad text-xs font-medium shrink-0">
                  Sign out
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-surface border border-line rounded-card p-4 mb-6">
        <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-2">Privacy</p>
        <p className="text-sm text-ink/90">Your exact location is never shown publicly — only used to confirm a verified log at the moment you make it.</p>
      </div>

      <button
        onClick={() => {
          clearSession();
          onSignOut();
        }}
        className="w-full text-bad text-sm font-medium py-3"
      >
        Sign out
      </button>
    </div>
  );
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-3 text-center">
      <div className="font-mono text-lg font-semibold tabular text-accent">{value}</div>
      <div className="text-faint text-[10px] mt-0.5">{label}</div>
    </div>
  );
}
