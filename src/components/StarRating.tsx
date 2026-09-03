import { useState } from "react";
import { motion } from "framer-motion";
import { LIQUID_SPRING } from "../motion";

const STAR_PATH =
  "M12 2.5l2.9 6.4 6.9.8-5.1 4.8 1.4 6.9L12 17.9l-6.1 3.5 1.4-6.9-5.1-4.8 6.9-.8L12 2.5z";

interface Props {
  value: number; // 0-10
  onChange: (v: number) => void;
}

export default function StarRating({ value, onChange }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  const glow = Math.max(0, Math.min(1, shown / 10));

  function pick(star: number, half: boolean) {
    onChange(half ? star * 2 - 1 : star * 2);
  }

  return (
    <div className="flex flex-col items-center">
      <motion.div
        animate={{
          filter: `drop-shadow(0 0 ${4 + glow * 26}px rgba(47,214,196,${0.25 + glow * 0.65})) drop-shadow(0 0 ${2 + glow * 10}px rgba(47,214,196,${0.4 + glow * 0.5}))`,
        }}
        transition={LIQUID_SPRING}
        className="flex items-center gap-1.5"
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const fillFraction = Math.max(0, Math.min(1, shown - (star - 1) * 2)) / 2;
          return (
            <button
              key={star}
              onMouseLeave={() => setHover(null)}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const half = e.clientX - rect.left < rect.width / 2;
                setHover(half ? star * 2 - 1 : star * 2);
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const half = e.clientX - rect.left < rect.width / 2;
                pick(star, half);
              }}
              className="relative w-11 h-11 shrink-0"
              aria-label={`${star * 2} out of 10`}
            >
              <svg viewBox="0 0 24 24" className="absolute inset-0 w-full h-full text-surface2" fill="currentColor">
                <path d={STAR_PATH} stroke="currentColor" strokeWidth="1" />
              </svg>
              <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - fillFraction * 100}% 0 0)` }}>
                <svg viewBox="0 0 24 24" className="w-11 h-11 text-accent" fill="currentColor">
                  <path d={STAR_PATH} />
                </svg>
              </div>
            </button>
          );
        })}
      </motion.div>
      <p className="text-faint text-[11px] mt-2">Tap the left or right half of a star for half-point precision</p>
    </div>
  );
}
