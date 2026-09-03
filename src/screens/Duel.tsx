import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { DishEntry, Verdict } from "../types";
import DishThumb from "../components/DishThumb";
import StarRating from "../components/StarRating";
import SwipeCard from "../components/SwipeCard";
import { LIQUID_SPRING, TAP_SCALE, HOVER_SCALE } from "../motion";
import { scoreEmoji } from "../verdictCopy";

interface Challenger {
  name: string;
  venue: string;
  emoji: string;
  tint: string;
  photo?: string;
}

export default function Duel({
  challenger,
  opponents,
  onDone,
}: {
  challenger: Challenger;
  opponents: DishEntry[]; // sorted descending by score — opponents[0] is the current #1 in this subtype
  onDone: (result: { score: number; verdict: Verdict }) => void;
}) {
  const [step, setStep] = useState<"bucket" | "compare" | "reveal" | "quick">("bucket");
  const [verdict, setVerdict] = useState<Verdict>("fine");
  const [quickScore, setQuickScore] = useState(7.5);
  const [lo, setLo] = useState(0);
  const [hi, setHi] = useState(opponents.length - 1);
  const [round, setRound] = useState(0);
  const [finalScore, setFinalScore] = useState(0);

  const maxRounds = Math.min(3, Math.max(1, Math.ceil(Math.log2(Math.max(opponents.length, 2)))));

  function startCompare(v: Verdict) {
    setVerdict(v);
    if (opponents.length === 0) {
      const seed = v === "loved" ? 8.6 : v === "fine" ? 7.2 : 5.4;
      setFinalScore(seed);
      setStep("reveal");
      return;
    }
    setStep("compare");
  }

  const mid = Math.floor((lo + hi) / 2);
  const opponent = opponents[Math.min(mid, opponents.length - 1)];

  function choose(preferChallenger: boolean) {
    const nextRound = round + 1;
    let nextLo = lo;
    let nextHi = hi;

    if (preferChallenger) nextLo = mid + 1;
    else nextHi = mid - 1;

    const isFinal = nextRound >= maxRounds || nextLo > nextHi || opponents.length <= 1;

    if (isFinal) {
      const anchor = opponent?.score ?? 7.5;
      const bump = preferChallenger ? 0.3 : -0.3;
      const seed = verdict === "loved" ? Math.max(anchor + bump, anchor) : verdict === "not-for-me" ? Math.min(anchor + bump, anchor) : anchor + bump * 0.5;
      setFinalScore(Math.max(1, Math.min(9.9, seed)));
      setStep("reveal");
      return;
    }
    setRound(nextRound);
    setLo(nextLo);
    setHi(nextHi);
  }

  if (step === "bucket") {
    return (
      <div className="px-5 pt-2 text-center">
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-1">Step 1 of 2</p>
        <h3 className="font-display font-bold text-xl mb-5">First take?</h3>

        <SwipeCard
          cardKey="bucket-card"
          onSwipeRight={() => startCompare("loved")}
          onSwipeLeft={() => startCompare("not-for-me")}
          rightLabel="YEAH 🔥"
          leftLabel="NAH 💀"
          className="bg-surface border border-line rounded-card p-4"
        >
          <DishThumb emoji={challenger.emoji} tint={challenger.tint} photo={challenger.photo} size="lg" scrim />
          <div className="mt-3 font-display font-bold text-lg leading-tight">{challenger.name}</div>
          <div className="text-faint text-xs mt-0.5">{challenger.venue}</div>
        </SwipeCard>

        <p className="text-faint text-xs mt-4 mb-4">Swipe right if you're obsessed, left if it's a hard pass</p>

        <div className="grid grid-cols-3 gap-2.5">
          <motion.button onClick={() => startCompare("not-for-me")} whileTap={TAP_SCALE} transition={LIQUID_SPRING} className="bg-surface2 border border-line rounded-xl py-3.5 text-xl">
            💀
          </motion.button>
          <motion.button onClick={() => startCompare("fine")} whileTap={TAP_SCALE} transition={LIQUID_SPRING} className="bg-surface2 border border-line rounded-xl py-3.5 text-[11px] font-medium text-muted">
            😐 mid
          </motion.button>
          <motion.button onClick={() => startCompare("loved")} whileTap={TAP_SCALE} transition={LIQUID_SPRING} className="bg-accentDim border border-accent/40 rounded-xl py-3.5 text-xl">
            🔥
          </motion.button>
        </div>

        {opponents.length > 0 && (
          <button onClick={() => setStep("quick")} className="w-full text-center text-faint text-xs underline underline-offset-2 mt-5">
            Skip the duel — just set the score myself
          </button>
        )}
      </div>
    );
  }

  if (step === "quick") {
    const inferredVerdict: Verdict = quickScore >= 8 ? "loved" : quickScore >= 6 ? "fine" : "not-for-me";
    return (
      <div className="px-5 pt-2 text-center">
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-1">Quick rate</p>
        <h3 className="font-display font-bold text-xl mb-6">Set the score yourself</h3>
        <div className="font-mono text-5xl font-semibold text-accent tabular mb-5">{quickScore.toFixed(1)}</div>
        <div className="mb-6 flex justify-center">
          <StarRating value={quickScore} onChange={setQuickScore} />
        </div>
        <p className="text-muted text-sm mb-8">
          Won't be compared against your other {challenger.name.split(" ").slice(-1)[0]} logs — this score is exactly what you set.
        </p>
        <motion.button
          onClick={() => onDone({ score: quickScore, verdict: inferredVerdict })}
          whileHover={HOVER_SCALE}
          whileTap={TAP_SCALE}
          transition={LIQUID_SPRING}
          className="w-full bg-accent text-accentInk font-semibold rounded-xl py-3.5"
        >
          Add to Palate
        </motion.button>
        <button onClick={() => setStep("bucket")} className="text-faint text-xs underline underline-offset-2 mt-4">
          Actually, let me duel it
        </button>
      </div>
    );
  }

  if (step === "compare") {
    return (
      <div className="px-5 pt-2 text-center">
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint mb-1">
          Step 2 of 2 · Round {round + 1} of {maxRounds}
        </p>
        <h3 className="font-display font-bold text-xl mb-1">Does this beat</h3>
        <p className="text-muted text-sm mb-5">{opponent.name} · {opponent.venue}?</p>

        <AnimatePresence mode="wait">
          <SwipeCard
            key={round}
            cardKey={`round-${round}`}
            onSwipeRight={() => choose(true)}
            onSwipeLeft={() => choose(false)}
            rightLabel="YEAH 🔥"
            leftLabel="NAH 💀"
            className="bg-surface border border-line rounded-card p-4"
          >
            <DishThumb emoji={challenger.emoji} tint={challenger.tint} photo={challenger.photo} size="lg" scrim />
            <div className="mt-3 font-display font-bold text-lg leading-tight">{challenger.name}</div>
            <div className="text-faint text-xs mt-0.5">{challenger.venue}</div>
          </SwipeCard>
        </AnimatePresence>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <motion.button onClick={() => choose(false)} whileTap={TAP_SCALE} transition={LIQUID_SPRING} className="bg-surface2 border border-line rounded-xl py-3.5 text-xs font-medium">
            ✕ Nah, the other wins
          </motion.button>
          <motion.button onClick={() => choose(true)} whileTap={TAP_SCALE} transition={LIQUID_SPRING} className="bg-accentDim border border-accent/40 rounded-xl py-3.5 text-xs font-medium text-accent">
            ♥ Yeah, this wins
          </motion.button>
        </div>
        <p className="text-center text-faint text-xs mt-4">Duels only run within the same subtype — never cross-category.</p>
      </div>
    );
  }

  // reveal
  const currentTop = opponents[0]?.score ?? null;
  const isNewTop = currentTop !== null && finalScore > currentTop;

  return (
    <div className="px-5 pt-2 text-center">
      <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-accent mb-3">Ranked</p>
      <motion.div
        className="text-5xl mb-1"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...LIQUID_SPRING, delay: 0.05 }}
      >
        {scoreEmoji(finalScore)}
      </motion.div>
      <motion.div
        className="font-mono text-5xl font-semibold text-accent tabular mb-2"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={LIQUID_SPRING}
      >
        {finalScore.toFixed(1)}
      </motion.div>
      {isNewTop && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...LIQUID_SPRING, delay: 0.1 }}
          className="text-accent text-xs font-medium mb-2"
        >
          ▲ new #1 in this subtype
        </motion.p>
      )}
      <p className="text-muted text-sm mb-8">out of 10, relative to your {challenger.name.split(" ").slice(-1)[0]} history</p>
      <motion.button
        onClick={() => onDone({ score: finalScore, verdict })}
        whileHover={HOVER_SCALE}
        whileTap={TAP_SCALE}
        transition={LIQUID_SPRING}
        className="w-full bg-accent text-accentInk font-semibold rounded-xl py-3.5"
      >
        Add to Palate
      </motion.button>
    </div>
  );
}
