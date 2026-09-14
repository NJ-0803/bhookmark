import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";

export const ONBOARDING_KEY = "bhookmark.onboarded";

const iconProps = {
  viewBox: "0 0 24 24",
  className: "w-5 h-5",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

// What the app actually does today: discovery, saving, and manual logging.
const STEPS: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "Find a dish worth the trip",
    body: "Search a craving or a place, or share your location once to see what's close.",
    icon: (
      <svg {...iconProps}>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4 4" />
      </svg>
    ),
  },
  {
    title: "Save it for later",
    body: "Tap the bookmark on any dish. Everything you save waits in Bhookmarks.",
    icon: (
      <svg {...iconProps}>
        <path d="M7 3.5h10a1 1 0 0 1 1 1V20l-6-3.6L6 20V4.5a1 1 0 0 1 1-1z" />
      </svg>
    ),
  },
  {
    title: "Log it, and rate it yourself",
    body: "Tap + after you eat. You choose the score out of 10 — Bhookmark never picks it for you.",
    icon: (
      <svg {...iconProps}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
];

function rise(i: number) {
  return { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { ...LIQUID_SPRING, delay: 0.05 + i * 0.07 } };
}

export default function Onboarding({ onDone }: { onDone: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] bg-bg overflow-y-auto"
      style={{ paddingTop: "max(24px, env(safe-area-inset-top))", paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}
    >
      <div className="min-h-full max-w-[380px] mx-auto px-6 flex flex-col justify-center">
        <motion.div {...rise(0)} className="relative aspect-[16/10] rounded-card overflow-hidden border border-line mb-7">
          <img src="/dishes/d1.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <span className="dish-name text-[24px] text-white">Benne Masala Dosa</span>
            <span className="block text-white/75 text-[14px] mt-0.5">CTR (Shri Sagar) · Malleshwaram</span>
          </div>
        </motion.div>

        <motion.p {...rise(1)} className="text-[13px] text-rose mb-1.5">
          Welcome to Bhookmark
        </motion.p>
        <motion.h1 {...rise(1)} className="font-display font-semibold text-[28px] leading-[1.12] tracking-[-0.02em] text-ink mb-6">
          Remember every dish worth going back for.
        </motion.h1>

        <ol className="flex flex-col gap-4 mb-8">
          {STEPS.map((step, i) => (
            <motion.li key={step.title} {...rise(i + 2)} className="flex gap-3.5">
              <span className="w-10 h-10 rounded-full bg-accentDim text-rose flex items-center justify-center shrink-0">{step.icon}</span>
              <div className="min-w-0">
                <p className="text-[16px] font-medium text-ink">{step.title}</p>
                <p className="text-[14px] text-muted leading-snug mt-0.5">{step.body}</p>
              </div>
            </motion.li>
          ))}
        </ol>

        <motion.button
          {...rise(5)}
          onClick={() => {
            localStorage.setItem(ONBOARDING_KEY, "1");
            onDone();
          }}
          whileTap={TAP_SCALE}
          className="w-full h-12 gradient-primary text-accentInk text-[15px] font-medium rounded-xl"
        >
          Start exploring
        </motion.button>
      </div>
    </div>
  );
}
