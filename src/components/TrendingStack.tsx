import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { DishEntry } from "../types";
import { CATEGORY_ACCENT, CATEGORY_SHADOW } from "../data/dishes";
import EvidenceScoreBadge from "./EvidenceScoreBadge";
import type { DishScoreResponse } from "../api";
import { LIQUID_SPRING } from "../motion";

export interface StackCard {
  dish: DishEntry;
  badge: string;
}

/** A fanned, draggable card stack instead of one flat rectangle — brief:
 * trending should feel discoverable, not like a single static banner.
 * Drag (or tap the peek behind) cycles the front card to the back. */
export default function TrendingStack({
  cards,
  scores,
  onSelect,
}: {
  cards: StackCard[];
  scores: Record<string, DishScoreResponse>;
  onSelect: (dish: DishEntry) => void;
}) {
  // V06 (implementation brief, 2026-09-08): this used to be a fixed
  // permutation of array INDICES, computed once at mount from whatever
  // `cards.length` happened to be that first render. In this app that's a
  // real, reproducible bug, not a hypothetical: Home's trending/recommended
  // picks load asynchronously, so this often mounts with just 1 fallback
  // card, then `cards` grows to 3 once real data arrives — but the frozen
  // order state stayed `[0]` forever, so the stack silently never showed
  // more than the first card even when more were available. Keying by the
  // dish's own stable id (not its position) and reconciling in an effect
  // whenever the real set of ids changes fixes both that and the crash/
  // stale-selection risk if a card disappears entirely (id no longer in
  // `cards` at all).
  const idsKey = cards.map((c) => c.dish.id).join("|");
  const [order, setOrder] = useState<string[]>(() => cards.map((c) => c.dish.id));

  useEffect(() => {
    setOrder((prevOrder) => {
      const currentIds = idsKey ? idsKey.split("|") : [];
      const currentSet = new Set(currentIds);
      // Keep the existing relative order for ids still present — so an
      // in-progress drag/cycle isn't reset by an unrelated re-render —
      // then append newly-arrived ids and drop ones no longer present.
      const kept = prevOrder.filter((id) => currentSet.has(id));
      const keptSet = new Set(kept);
      const added = currentIds.filter((id) => !keptSet.has(id));
      return [...kept, ...added];
    });
    // idsKey is the real dependency (a stable string derived from the ids);
    // `cards` itself gets a new array identity on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  function cycle() {
    setOrder((prev) => (prev.length > 1 ? [...prev.slice(1), prev[0]] : prev));
  }

  if (cards.length === 0) return null;
  const byId = new Map(cards.map((c) => [c.dish.id, c]));
  const visible = order.map((id) => byId.get(id)).filter((c): c is StackCard => !!c).slice(0, 3);

  return (
    // Responsive aspect-ratio height (not a hardcoded pixel value) — a fixed
    // 220px assumed a card width this app never guarantees, so on a narrower
    // real phone the 16:10 card was taller than its own box and bled into
    // whatever came next. paddingBottom scales with the actual rendered
    // width instead, plus room for the peek offset and the caption below.
    <div className="relative mb-9" style={{ paddingBottom: "calc(62.5% + 20px)" }}>
      {visible.map(({ dish, badge }, stackPos) => {
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
              whileTap={isFront ? { rotate: 2, scale: 0.98, transition: LIQUID_SPRING } : undefined}
              transition={LIQUID_SPRING}
              style={{ zIndex: 10 - stackPos, touchAction: isFront ? "pan-y" : undefined }}
              className={`absolute inset-x-0 aspect-[16/10] rounded-card overflow-hidden text-left border cursor-grab active:cursor-grabbing ${
                isFront ? `border-accent/40 ${CATEGORY_SHADOW[dish.category] ?? "shadow-lift"}` : "border-line"
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
              {/* Phase 1 honesty fix (2026-09-10): was `dish.score` — the
                  static seed value — rendered unconditionally as a real
                  score. Now only shows a number once real logs back it. */}
              <EvidenceScoreBadge community={scores[dish.id]?.community} size="sm" className="absolute top-3 right-3" />
              <div className="relative h-full flex flex-col justify-end p-4">
                <div className="font-display font-extrabold text-xl text-white leading-tight drop-shadow">{dish.name}</div>
                <div className="text-white/70 text-sm mt-0.5">{dish.venue} · {dish.area}</div>
              </div>
            </motion.div>
          );
        })}
      {cards.length > 1 && (
        <p className="absolute bottom-0 inset-x-0 text-center text-faint text-[11px]">Drag to see what else is hot</p>
      )}
    </div>
  );
}
