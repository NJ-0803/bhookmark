import { motion } from "framer-motion";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";

export const ONBOARDING_KEY = "bhookmark.onboarded";

export default function Onboarding({ onDone }: { onDone: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] bg-bg flex flex-col items-center justify-center px-8 text-center">
      <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint mb-2">Before you start</p>
      <h1 className="font-display font-extrabold text-2xl mb-8 text-balance">Two ways to answer</h1>

      <div className="relative w-full max-w-[240px] h-64 mb-10">
        <motion.div
          animate={{ x: [0, 90, 0, -90, 0], rotate: [0, 10, 0, -10, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 bg-surface border border-line rounded-card flex flex-col items-center justify-center gap-2"
        >
          <span className="text-4xl">🍔</span>
          <span className="text-sm font-medium text-muted">Peri Peri Chicken Burger</span>
        </motion.div>
        <motion.span
          animate={{ opacity: [0, 0, 1, 0, 0, 0, 0, 0] }}
          transition={{ duration: 4, repeat: Infinity, times: [0, 0.15, 0.25, 0.4, 0.5, 0.65, 0.85, 1] }}
          className="absolute top-3 right-3 text-accent border-2 border-accent rounded-lg px-2.5 py-1 text-xs font-bold rotate-6"
        >
          YEAH
        </motion.span>
        <motion.span
          animate={{ opacity: [0, 0, 0, 0, 0, 1, 0, 0] }}
          transition={{ duration: 4, repeat: Infinity, times: [0, 0.15, 0.25, 0.4, 0.5, 0.65, 0.85, 1] }}
          className="absolute top-3 left-3 text-bad border-2 border-bad rounded-lg px-2.5 py-1 text-xs font-bold -rotate-6"
        >
          NAH
        </motion.span>
      </div>

      <div className="flex flex-col gap-4 mb-10 text-left max-w-[300px]">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-accentDim text-accent flex items-center justify-center text-lg shrink-0">→</span>
          <p className="text-sm text-ink/90"><span className="text-accent font-semibold">Swipe right</span> for a yeah — loved it, or this one wins a duel.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-badDim text-bad flex items-center justify-center text-lg shrink-0">←</span>
          <p className="text-sm text-ink/90"><span className="text-bad font-semibold">Swipe left</span> for a nah — not for you, or the other one wins.</p>
        </div>
      </div>

      <motion.button
        onClick={() => { localStorage.setItem(ONBOARDING_KEY, "1"); onDone(); }}
        whileTap={TAP_SCALE}
        transition={LIQUID_SPRING}
        className="w-full max-w-[300px] bg-accent text-accentInk font-semibold rounded-xl py-3.5"
      >
        Got it
      </motion.button>
    </div>
  );
}
