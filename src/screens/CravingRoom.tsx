import { useEffect, useMemo, useState } from "react";
import { motion, useMotionValue, useTransform, animate, AnimatePresence } from "framer-motion";
import { DISHES } from "../data/dishes";
import DishThumb from "../components/DishThumb";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";

const MOODS = ["Quick bite", "Sit-down", "Something new", "Comfort food"];
const FRIENDS = [
  { name: "Aish", initial: "A", tint: "from-rose-500/40 to-rose-900/50" },
  { name: "Rohan", initial: "R", tint: "from-cyan-500/40 to-cyan-900/50" },
];
const SWIPE_THRESHOLD = 110;

export default function CravingRoom() {
  const [step, setStep] = useState<"setup" | "swiping" | "reveal">("setup");
  const [radius, setRadius] = useState(3);
  const [mood, setMood] = useState(MOODS[0]);
  const [idx, setIdx] = useState(0);
  const [liked, setLiked] = useState<string[]>([]);

  const candidates = useMemo(() => DISHES.slice(0, 6), []);

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

        <div className="flex items-center gap-2 mb-6">
          {FRIENDS.map((f) => (
            <div key={f.name} className={`w-9 h-9 rounded-full bg-gradient-to-br ${f.tint} border border-line flex items-center justify-center text-xs font-semibold`}>
              {f.initial}
            </div>
          ))}
          <span className="text-muted text-xs ml-1">Aish and Rohan have joined</span>
        </div>

        <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-2">Radius</p>
        <input type="range" min={1} max={10} value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Search radius in kilometers" className="w-full accent-accent mb-1" />
        <p className="text-sm text-ink/80 mb-6">{radius} km from Koramangala</p>

        <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-2">Mood</p>
        <div className="flex flex-wrap gap-2 mb-8">
          {MOODS.map((m) => (
            <motion.button
              key={m}
              onClick={() => setMood(m)}
              whileTap={TAP_SCALE}
              transition={LIQUID_SPRING}
              className={`text-xs font-medium px-3 py-2 rounded-full border ${
                mood === m ? "bg-accent text-accentInk border-accent" : "bg-surface border-line text-muted"
              }`}
            >
              {m}
            </motion.button>
          ))}
        </div>

        <motion.button
          onClick={() => setStep("swiping")}
          whileTap={TAP_SCALE}
          transition={LIQUID_SPRING}
          className="w-full bg-accent text-accentInk font-semibold rounded-xl py-3.5"
        >
          Start swiping
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

  return (
    <div className="px-5 pt-8 pb-32">
      <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-accent mb-2">Everyone's in</p>
      <h1 className="font-display font-extrabold text-2xl mb-6">Tonight's overlap</h1>

      {overlap.length > 0 ? (
        <div className="flex flex-col gap-2.5 mb-6">
          {overlap.map((d) => (
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
      ) : (
        <p className="text-muted text-sm mb-6">No unanimous pick this time — here's what came close.</p>
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
