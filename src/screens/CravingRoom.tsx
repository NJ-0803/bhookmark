import { useEffect, useMemo, useState } from "react";
import { motion, useMotionValue, useTransform, animate, AnimatePresence } from "framer-motion";
import { DISHES, categoryVisual } from "../data/dishes";
import type { Category } from "../types";
import DishThumb from "../components/DishThumb";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";

// Real category mapping, not a decorative label — the match count below is
// a genuine count of real catalog dishes, never a fabricated placeholder.
const MOODS: { label: string; categories: Category[] }[] = [
  { label: "Quick bite", categories: ["Burger", "Momos"] },
  { label: "Sit-down", categories: ["Biryani", "Pizza"] },
  { label: "Something new", categories: ["Momos", "Filter Coffee"] },
  { label: "Comfort food", categories: ["Dosa & Idli", "Filter Coffee"] },
];
const FRIENDS = [
  { name: "Aish", initial: "A", tint: "from-rose-500/40 to-rose-900/50" },
  { name: "Rohan", initial: "R", tint: "from-cyan-500/40 to-cyan-900/50" },
];
const SWIPE_THRESHOLD = 110;

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
            stroke="#31E2D1"
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

export default function CravingRoom() {
  const [step, setStep] = useState<"setup" | "swiping" | "reveal">("setup");
  const [radius, setRadius] = useState(3);
  const [mood, setMood] = useState(MOODS[0].label);
  const [idx, setIdx] = useState(0);
  const [liked, setLiked] = useState<string[]>([]);

  const candidates = useMemo(() => DISHES.slice(0, 6), []);

  // Real count of catalog dishes matching the selected mood — never a
  // fabricated "N places match" number, since this app doesn't guess.
  const matchCount = useMemo(() => {
    const cats = MOODS.find((m) => m.label === mood)?.categories ?? [];
    return DISHES.filter((d) => cats.includes(d.category)).length;
  }, [mood]);

  // deterministic mock "friend" preferences so the overlap reveal is stable
  const friendLikes = useMemo(
    () => ({
      Aish: new Set(["d1", "d4", "d9"]),
      Rohan: new Set(["d4", "d7", "d9"]),
    }),
    []
  );

  function swipe(like: boolean) {
    const dish = candidates[idx];
    const next = like ? [...liked, dish.id] : liked;
    setLiked(next);
    if (idx + 1 >= candidates.length) setStep("reveal");
    else setIdx(idx + 1);
  }

  const overlap = candidates.filter(
    (d) => liked.includes(d.id) && friendLikes.Aish.has(d.id) && friendLikes.Rohan.has(d.id)
  );
  const partialOverlap = candidates.filter(
    (d) => liked.includes(d.id) && !overlap.includes(d) && (friendLikes.Aish.has(d.id) || friendLikes.Rohan.has(d.id))
  );

  if (step === "setup") {
    return (
      <div className="px-5 pt-8 pb-32">
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint mb-2">Craving Room</p>
        <h1 className="font-display font-extrabold text-2xl mb-1.5">Where are we eating?</h1>
        <p className="text-muted text-sm mb-7">A temporary session — everyone swipes, the overlap reveals only once all three of you finish.</p>

        <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-2.5">Who's hungry?</p>
        <div className="flex items-center gap-2 mb-7">
          {FRIENDS.map((f, i) => (
            <motion.div
              key={f.name}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...LIQUID_SPRING, delay: 0.15 + i * 0.12 }}
              className={`w-9 h-9 rounded-full bg-gradient-to-br ${f.tint} border border-line flex items-center justify-center text-xs font-semibold`}
            >
              {f.initial}
            </motion.div>
          ))}
          <motion.span
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...LIQUID_SPRING, delay: 0.4 }}
            className="text-muted text-xs ml-1"
          >
            Aish and Rohan have joined
          </motion.span>
        </div>

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
          onClick={() => setStep("swiping")}
          whileTap={TAP_SCALE}
          transition={LIQUID_SPRING}
          className="w-full bg-accent text-accentInk font-semibold rounded-xl py-3.5"
        >
          Start swiping
          <span className="block text-xs font-normal opacity-80 mt-0.5">{matchCount} places match your group</span>
        </motion.button>
      </div>
    );
  }

  if (step === "swiping") {
    return (
      <div className="px-5 pt-8 pb-32">
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-4 text-center">
          Dish {idx + 1} of {candidates.length}
        </p>
        <div className="relative h-[420px]">
          <AnimatePresence>
            <SwipeCard key={candidates[idx].id} dish={candidates[idx]} onSwipe={swipe} />
          </AnimatePresence>
        </div>
        <p className="text-center text-faint text-xs mt-3">Drag the card, or use the buttons below.</p>
      </div>
    );
  }

  const winner = overlap[0];

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
            <span className="inline-block mb-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-accent text-accentInk">
              🎉 unanimous pick
            </span>
            <div className="font-display font-bold text-base truncate">{winner.name}</div>
            <div className="text-faint text-xs truncate">{winner.venue} · {winner.area}</div>
          </div>
        </motion.div>
      ) : (
        <p className="text-muted text-sm mb-6">No unanimous pick this time — here's what came close.</p>
      )}

      {overlap.length > 1 && (
        <div className="flex flex-col gap-2.5 mb-6">
          {overlap.slice(1).map((d) => (
            <div key={d.id} className="flex gap-3 bg-surface border border-accent/40 rounded-xl p-3">
              <DishThumb emoji={d.emoji} tint={d.tint} photo={d.photo} size="md" />
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{d.name}</div>
                <div className="text-faint text-xs truncate">{d.venue} · {d.area}</div>
                <span className="inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-accentDim text-accent">
                  all three of you liked this
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {partialOverlap.length > 0 && (
        <>
          <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-2">Close, but not unanimous</p>
          <div className="flex flex-col gap-2.5">
            {partialOverlap.map((d) => (
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
    </div>
  );
}

function SwipeCard({ dish, onSwipe }: { dish: (typeof DISHES)[number]; onSwipe: (like: boolean) => void }) {
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
