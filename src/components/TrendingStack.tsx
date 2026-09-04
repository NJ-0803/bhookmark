import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { DishEntry } from "../types";
import { CATEGORY_ACCENT, CATEGORY_SHADOW } from "../data/dishes";
import ScoreBadge from "../components/ScoreBadge";
import { LIQUID_SPRING } from "../motion";

export interface StackCard {
  dish: DishEntry;
  badge: string;
}

/** A fanned, draggable card stack instead of one flat rectangle — brief:
 * trending should feel discoverable, not like a single static banner.
 * Drag (or tap the peek behind) cycles the front card to the back. */
export default function TrendingStack({ cards, onSelect }: { cards: StackCard[]; onSelect: (dish: DishEntry) => void }) {
  const [order, setOrder] = useState(() => cards.map((_, i) => i));

  function cycle() {
    setOrder((prev) => [...prev.slice(1), prev[0]]);
  }

  if (cards.length === 0) return null;
  const visible = order.slice(0, 3);

  return (
    // Responsive aspect-ratio height (not a hardcoded pixel value) — a fixed
    // 220px assumed a card width this app never guarantees, so on a narrower
    // real phone the 16:10 card was taller than its own box and bled into
    // whatever came next. paddingBottom scales with the actual rendered
    // width instead, plus room for the peek offset and the caption below.
    <div className="relative mb-9" style={{ paddingBottom: "calc(62.5% + 20px)" }}>
      <AnimatePresence>
        {visible.map((cardIndex, stackPos) => {
          const { dish, badge } = cards[cardIndex];
          const isFront = stackPos === 0;
          return (
            <motion.div
              key={dish.id}
              drag={isFront ? "x" : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.6}
              onDragEnd={(_, info) => {
                if (Math.abs(info.offset.x) > 90) cycle();
              }}
              onClick={() => (isFront ? onSelect(dish) : cycle())}
              initial={false}
              animate={{
                scale: 1 - stackPos * 0.05,
                y: stackPos * 10,
                rotate: stackPos === 0 ? 0 : stackPos === 1 ? -3 : 3,
                opacity: 1 - stackPos * 0.18,
              }}
              whileHover={isFront ? { rotate: 2, y: -4, transition: LIQUID_SPRING } : undefined}
              whileTap={isFront ? { scale: 0.98 } : undefined}
              transition={LIQUID_SPRING}
              style={{ zIndex: 10 - stackPos, touchAction: isFront ? "pan-y" : undefined }}
              className={`absolute inset-x-0 aspect-[16/10] rounded-card overflow-hidden text-left border border-line cursor-grab active:cursor-grabbing ${
                isFront ? `shadow-lift ${CATEGORY_SHADOW[dish.category] ?? ""}` : ""
              }`}
            >
              {dish.photo ? (
                <img src={dish.photo} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" draggable={false} />
              ) : (
                <div className={`absolute inset-0 bg-gradient-to-br ${dish.tint} bg-surface2 flex items-center justify-center text-6xl`}>{dish.emoji}</div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/10" />
              <span className={`absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${CATEGORY_ACCENT[dish.category]}`}>
                {badge}
              </span>
              {dish.score > 0 && <ScoreBadge score={dish.score} size="sm" className="absolute top-3 right-3" />}
              <div className="relative h-full flex flex-col justify-end p-4">
                <div className="font-display font-extrabold text-xl text-white leading-tight drop-shadow">{dish.name}</div>
                <div className="text-white/70 text-sm mt-0.5">{dish.venue} · {dish.area}</div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {cards.length > 1 && (
        <p className="absolute bottom-0 inset-x-0 text-center text-faint text-[11px]">Drag to see what else is hot</p>
      )}
    </div>
  );
}
