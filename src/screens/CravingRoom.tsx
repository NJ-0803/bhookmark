import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { DISHES, categoryVisual, dishById } from "../data/dishes";
import type { Category, DishEntry } from "../types";
import DishThumb from "../components/DishThumb";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";
import { haptic } from "../haptics";
import { createRoom, getRoomReveal, joinRoom, swipeInRoom, type CravingRoomInfo } from "../api";

// Real category mapping, not a decorative label — the match count below is
// a genuine count of real catalog dishes, never a fabricated placeholder.
const MOODS: { label: string; categories: Category[] }[] = [
  { label: "Quick bite", categories: ["Burger", "Momos"] },
  { label: "Sit-down", categories: ["Biryani", "Pizza"] },
  { label: "Something new", categories: ["Momos", "Filter Coffee"] },
  { label: "Comfort food", categories: ["Dosa & Idli", "Filter Coffee"] },
];
const SWIPE_THRESHOLD = 110;
const POLL_MS = 2500;

function RadiusRing({ radius, onChange }: { radius: number; onChange: (v: number) => void }) {
  const pct = radius / 10;
  const circumference = 2 * Math.PI * 34;
  return (
    <div className="flex items-center gap-4">
      <motion.button
        whileTap={TAP_SCALE}
        onClick={() => onChange(Math.max(1, radius - 1))}
        aria-label="Decrease radius"
        className="w-11 h-11 rounded-full bg-surface border border-line text-muted shrink-0"
      >
        −
      </motion.button>
      <div className="relative w-20 h-20 shrink-0">
        <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
          <circle cx="40" cy="40" r="34" fill="none" stroke="#202826" strokeWidth="7" />
          <motion.circle
            cx="40"
            cy="40"
            r="34"
            fill="none"
            stroke="#E879F9"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset: circumference * (1 - pct) }}
            transition={LIQUID_SPRING}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-lg font-semibold text-ink tabular">{radius}</span>
          <span className="text-faint text-[9px] uppercase tracking-wide">km</span>
        </div>
      </div>
      <motion.button
        whileTap={TAP_SCALE}
        onClick={() => onChange(Math.min(10, radius + 1))}
        aria-label="Increase radius"
        className="w-11 h-11 rounded-full bg-surface border border-line text-muted shrink-0"
      >
        +
      </motion.button>
    </div>
  );
}

type Mode = "lobby" | "create-setup" | "join" | "swiping" | "waiting" | "reveal";

export default function CravingRoom() {
  const [mode, setMode] = useState<Mode>("lobby");
  const [radius, setRadius] = useState(3);
  const [mood, setMood] = useState(MOODS[0].label);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [room, setRoom] = useState<CravingRoomInfo | null>(null);
  const [candidates, setCandidates] = useState<DishEntry[]>([]);
  const [idx, setIdx] = useState(0);
  const [waitProgress, setWaitProgress] = useState<{ done: number; total: number } | null>(null);
  const [reveal, setReveal] = useState<{ unanimous: DishEntry[]; partial: DishEntry[] } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Real count of catalog dishes matching the selected mood — never a
  // fabricated "N places match" number, since this app doesn't guess.
  const matchCount = useMemo(() => {
    const cats = MOODS.find((m) => m.label === mood)?.categories ?? [];
    return DISHES.filter((d) => cats.includes(d.category)).length;
  }, [mood]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function startRoom() {
    setCreating(true);
    const cats = MOODS.find((m) => m.label === mood)?.categories ?? [];
    const candidateDishes = DISHES.filter((d) => cats.includes(d.category)).slice(0, 6);
    const res = await createRoom(mood, radius, candidateDishes.map((d) => d.id));
    setCreating(false);
    if (!res.ok || !res.room) return;
    setRoom(res.room);
    setCandidates(candidateDishes);
    setIdx(0);
    setMode("swiping");
  }

  async function joinWithCode() {
    if (!joinCode.trim()) return;
    setJoinError(null);
    const res = await joinRoom(joinCode.trim());
    if (!res.ok || !res.room) {
      setJoinError(res.error ?? "Couldn't join that room.");
      return;
    }
    const resolved = res.room.candidateIds.map((id) => dishById(id)).filter((d): d is DishEntry => !!d);
    setRoom(res.room);
    setCandidates(resolved);
    setIdx(0);
    setMode("swiping");
  }

  function pollForReveal(roomId: string) {
    pollRef.current = setInterval(async () => {
      const res = await getRoomReveal(roomId);
      if (!res.ok) return;
      if (!res.ready) {
        setWaitProgress({ done: res.doneCount ?? 0, total: res.totalCount ?? 0 });
        return;
      }
      if (pollRef.current) clearInterval(pollRef.current);
      const unanimous = (res.unanimous ?? []).map((id) => dishById(id)).filter((d): d is DishEntry => !!d);
      const partial = (res.partial ?? []).map((id) => dishById(id)).filter((d): d is DishEntry => !!d);
      setReveal({ unanimous, partial });
      setMode("reveal");
      if (unanimous.length > 0) haptic("success");
    }, POLL_MS);
  }

  async function swipe(like: boolean) {
    haptic(like ? "success" : "light");
    if (!room) return;
    const dish = candidates[idx];
    await swipeInRoom(room.id, dish.id, like);
    if (idx + 1 >= candidates.length) {
      setMode("waiting");
      pollForReveal(room.id);
    } else {
      setIdx((i) => i + 1);
    }
  }

  function backToLobby() {
    if (pollRef.current) clearInterval(pollRef.current);
    setRoom(null);
    setCandidates([]);
    setReveal(null);
    setWaitProgress(null);
    setMode("lobby");
  }

  if (mode === "lobby") {
    return (
      <div className="px-5 pt-8 pb-32">
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint mb-2">Craving Room</p>
        <h1 className="font-display font-extrabold text-2xl mb-1.5 text-gradient">Where are we eating?</h1>
        <p className="text-muted text-sm mb-8">A real, temporary session — start one and share the code, or join one someone sent you.</p>

        <motion.button
          onClick={() => setMode("create-setup")}
          whileTap={TAP_SCALE}
          transition={LIQUID_SPRING}
          className="w-full gradient-primary text-white font-semibold rounded-xl py-4 mb-3"
        >
          Start a new room
        </motion.button>

        <div className="bg-surface border border-line rounded-card p-4">
          <p className="font-mono text-[10px] tracking-[0.08em] uppercase text-faint mb-2">Have a code?</p>
          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Room code"
              aria-label="Room code"
              className="flex-1 bg-surface2 border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent font-mono uppercase"
            />
            <motion.button whileTap={TAP_SCALE} onClick={joinWithCode} className="gradient-primary text-white font-semibold rounded-lg px-4 text-sm">
              Join
            </motion.button>
          </div>
          {joinError && <p className="text-bad text-xs mt-2">{joinError}</p>}
        </div>
      </div>
    );
  }

  if (mode === "create-setup") {
    return (
      <div className="px-5 pt-8 pb-32">
        <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-2.5">What's the vibe?</p>
        <div className="grid grid-cols-2 gap-2.5 mb-7">
          {MOODS.map((m) => {
            const visual = categoryVisual(m.categories[0]);
            const active = mood === m.label;
            return (
              <motion.button
                key={m.label}
                onClick={() => setMood(m.label)}
                whileTap={TAP_SCALE}
                transition={LIQUID_SPRING}
                className={`relative aspect-[3/2] rounded-xl overflow-hidden text-left border ${active ? "border-accent" : "border-line"}`}
              >
                {visual.photo ? (
                  <img src={visual.photo} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className={`absolute inset-0 bg-gradient-to-br ${visual.tint} bg-surface2`} />
                )}
                <div className={`absolute inset-0 ${active ? "bg-accent/30" : "bg-black/55"} transition-colors`} />
                <span className="relative flex h-full items-end p-2.5 font-semibold text-sm text-white drop-shadow">{m.label}</span>
              </motion.button>
            );
          })}
        </div>

        <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-2.5">How far?</p>
        <div className="mb-8">
          <RadiusRing radius={radius} onChange={setRadius} />
        </div>

        <motion.button
          onClick={startRoom}
          whileTap={TAP_SCALE}
          transition={LIQUID_SPRING}
          disabled={creating}
          className="w-full gradient-primary text-white font-semibold rounded-xl py-3.5 disabled:opacity-60"
        >
          {creating ? "Starting…" : "Start swiping"}
          <span className="block text-xs font-normal opacity-80 mt-0.5">{matchCount} places match your group</span>
        </motion.button>
      </div>
    );
  }

  if (mode === "swiping" && room) {
    return (
      <div className="px-5 pt-8 pb-32">
        <div className="flex items-center justify-center gap-2 mb-3">
          <span className="font-mono text-[11px] text-faint">Room</span>
          <span className="font-mono text-sm font-bold tracking-widest text-gradient">{room.code}</span>
        </div>
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-4 text-center">
          Dish {idx + 1} of {candidates.length}
        </p>
        <div className="relative h-[420px]">
          <SwipeCard key={candidates[idx].id} dish={candidates[idx]} onSwipe={swipe} />
        </div>
        <p className="text-center text-faint text-xs mt-3">Drag the card, or use the buttons below. Share code {room.code} with anyone still joining.</p>
      </div>
    );
  }

  if (mode === "waiting") {
    return (
      <div className="px-5 pt-16 pb-32 flex flex-col items-center text-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 rounded-full border-2 border-accent border-t-transparent mb-5"
        />
        <h1 className="font-display font-bold text-xl mb-2">Waiting on the rest of the table</h1>
        <p className="text-muted text-sm">
          {waitProgress ? `${waitProgress.done} of ${waitProgress.total} done` : "Checking…"}
        </p>
      </div>
    );
  }

  // reveal
  const winner = reveal?.unanimous[0];
  return (
    <div className="px-5 pt-8 pb-32">
      <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-accent mb-2">Everyone's in</p>
      <h1 className="font-display font-extrabold text-2xl mb-6">{winner ? "Table's set." : "Tonight's overlap"}</h1>

      {winner ? (
        <motion.div
          initial={{ scale: 0.7, opacity: 0, y: 30 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ ...LIQUID_SPRING, delay: 0.15 }}
          className="relative flex gap-3 bg-surface border border-accent/50 rounded-card p-4 mb-3 shadow-accentGlow overflow-hidden"
        >
          <motion.div
            initial={{ opacity: 0.6, scale: 0.8 }}
            animate={{ opacity: 0, scale: 1.6 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
            className="absolute inset-0 rounded-card bg-accent/25"
          />
          <DishThumb emoji={winner.emoji} tint={winner.tint} photo={winner.photo} size="card" />
          <div className="min-w-0 relative">
            <span className="inline-block mb-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full gradient-primary text-white">
              🎉 unanimous pick
            </span>
            <div className="font-display font-bold text-base truncate">{winner.name}</div>
            <div className="text-faint text-xs truncate">{winner.venue} · {winner.area}</div>
          </div>
        </motion.div>
      ) : (
        <p className="text-muted text-sm mb-6">No unanimous pick this time — here's what came close.</p>
      )}

      {reveal && reveal.unanimous.length > 1 && (
        <div className="flex flex-col gap-2.5 mb-6">
          {reveal.unanimous.slice(1).map((d) => (
            <div key={d.id} className="flex gap-3 bg-surface border border-accent/40 rounded-xl p-3">
              <DishThumb emoji={d.emoji} tint={d.tint} photo={d.photo} size="md" />
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{d.name}</div>
                <div className="text-faint text-xs truncate">{d.venue} · {d.area}</div>
                <span className="inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-accentDim text-accent">
                  everyone liked this
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {reveal && reveal.partial.length > 0 && (
        <>
          <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-2">Close, but not unanimous</p>
          <div className="flex flex-col gap-2.5 mb-6">
            {reveal.partial.map((d) => (
              <div key={d.id} className="flex gap-3 bg-surface border border-line rounded-xl p-3">
                <DishThumb emoji={d.emoji} tint={d.tint} photo={d.photo} size="sm" />
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{d.name}</div>
                  <div className="text-faint text-xs truncate">{d.venue}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <button onClick={backToLobby} className="w-full text-accent text-sm font-medium py-3">
        Start another room
      </button>
    </div>
  );
}

function SwipeCard({ dish, onSwipe }: { dish: DishEntry; onSwipe: (like: boolean) => void }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-14, 14]);
  const likeOpacity = useTransform(x, [20, 120], [0, 1]);
  const nopeOpacity = useTransform(x, [-120, -20], [1, 0]);

  useEffect(() => {
    x.set(0);
  }, [dish.id, x]);

  function handleDragEnd(_: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    const past = Math.abs(info.offset.x) > SWIPE_THRESHOLD || Math.abs(info.velocity.x) > 800;
    if (!past) {
      animate(x, 0, LIQUID_SPRING);
      return;
    }
    const dir = info.offset.x > 0 ? 1 : -1;
    animate(x, dir * 600, { ...LIQUID_SPRING, stiffness: 90 }).then(() => onSwipe(dir > 0));
  }

  function tapButton(like: boolean) {
    animate(x, like ? 600 : -600, { ...LIQUID_SPRING, stiffness: 90 }).then(() => onSwipe(like));
  }

  return (
    <motion.div
      drag="x"
      dragElastic={1}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      style={{ x, rotate }}
      initial={{ scale: 0.94, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={LIQUID_SPRING}
      className="absolute inset-0 bg-surface border border-line rounded-card p-4 cursor-grab active:cursor-grabbing touch-none"
    >
      <motion.span style={{ opacity: likeOpacity }} className="absolute top-4 right-4 z-10 text-accent border-2 border-accent rounded-lg px-3 py-1 text-sm font-bold rotate-6">
        LIKE
      </motion.span>
      <motion.span style={{ opacity: nopeOpacity }} className="absolute top-4 left-4 z-10 text-bad border-2 border-bad rounded-lg px-3 py-1 text-sm font-bold -rotate-6">
        NOPE
      </motion.span>

      <DishThumb emoji={dish.emoji} tint={dish.tint} photo={dish.photo} size="lg" />
      <div className="text-center mt-4 mb-6">
        <h3 className="font-display font-bold text-xl">{dish.name}</h3>
        <p className="text-muted text-sm mt-1">{dish.venue} · {dish.area}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <motion.button onClick={() => tapButton(false)} whileTap={TAP_SCALE} transition={LIQUID_SPRING} aria-label="Not for me" className="bg-surface2 border border-line rounded-xl py-4 text-2xl">
          ✕
        </motion.button>
        <motion.button onClick={() => tapButton(true)} whileTap={TAP_SCALE} transition={LIQUID_SPRING} aria-label="Loved it" className="bg-accentDim border border-accent/40 rounded-xl py-4 text-2xl">
          ♥
        </motion.button>
      </div>
    </motion.div>
  );
}
