import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { DishEntry } from "../types";
import { FloatCard, FloatMedia } from "./CardStage";
import CategoryArt from "./CategoryArt";
import { LIQUID_SPRING } from "../motion";
import { placeLine } from "../format";

export interface StackCard {
  dish: DishEntry;
  badge: string;
}

/** A photo-led fanned stack: drag the front card to cycle, tap it to lift it
 * into a panel, or tap a peeking card to bring it forward. */
export default function TrendingStack({
  cards,
  renderPanel,
}: {
  cards: StackCard[];
  renderPanel: (dish: DishEntry, mediaId: string) => ReactNode;
}) {
  // V06: order is keyed by dish id and reconciled whenever the id set
  // changes — cards arrive asynchronously, and a mount-time index order froze
  // the stack at its first (often single) card.
  const idsKey = cards.map((c) => c.dish.id).join("|");
  const [order, setOrder] = useState<string[]>(() => cards.map((c) => c.dish.id));

  useEffect(() => {
    setOrder((prevOrder) => {
      const currentIds = idsKey ? idsKey.split("|") : [];
      const currentSet = new Set(currentIds);
      const kept = prevOrder.filter((id) => currentSet.has(id));
      const keptSet = new Set(kept);
      return [...kept, ...currentIds.filter((id) => !keptSet.has(id))];
    });
    // idsKey is the real dependency; `cards` gets a new identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  function cycle() {
    setOrder((prev) => (prev.length > 1 ? [...prev.slice(1), prev[0]] : prev));
  }

  if (cards.length === 0) return null;
  const byId = new Map(cards.map((c) => [c.dish.id, c]));
  const visible = order.map((id) => byId.get(id)).filter((c): c is StackCard => !!c).slice(0, 3);

  return (
    <div className="relative">
      {/* Reserves the front card's height plus the fanned offset, so nothing
          shifts while photos load. */}
      <div className="aspect-[16/11] lg:aspect-[16/10]" />
      <div className="h-5" />
      {visible.map(({ dish, badge }, stackPos) => {
        const isFront = stackPos === 0;
        const id = `stack-${dish.id}`;
        const overlay = (
          <>
            {dish.photo && <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />}
            <span className="absolute top-3.5 left-3.5 text-[12px] text-white/90 bg-black/55 rounded-full px-2.5 py-1">{badge}</span>
            <div className="absolute inset-x-0 bottom-0 p-4 lg:p-5">
              <span className={`dish-name text-[24px] lg:text-[30px] line-clamp-2 ${dish.photo ? "text-white" : "text-ink"}`}>{dish.name}</span>
              <span className={`block text-[14px] mt-1 ${dish.photo ? "text-white/75" : "text-muted"}`}>{placeLine(dish)}</span>
            </div>
          </>
        );
        return (
          <motion.div
            key={dish.id}
            drag={isFront ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.6}
            onDragEnd={(_, info) => {
              if (Math.abs(info.offset.x) > 90) cycle();
            }}
            onClick={isFront ? undefined : cycle}
            initial={false}
            animate={{ scale: 1 - stackPos * 0.045, y: stackPos * 10, opacity: 1 - stackPos * 0.3 }}
            transition={LIQUID_SPRING}
            style={{ zIndex: 10 - stackPos, touchAction: isFront ? "pan-y" : undefined }}
            className="absolute inset-x-0 top-0 aspect-[16/11] lg:aspect-[16/10] cursor-grab active:cursor-grabbing"
          >
            {isFront ? (
              <FloatCard
                id={id}
                label={dish.name}
                wide
                className="absolute inset-0 bg-surface2 border border-line"
                contentClassName="absolute inset-0"
                panel={() => renderPanel(dish, `${id}-media`)}
              >
                <FloatMedia id={`${id}-media`} photo={dish.photo} category={dish.category} className="absolute inset-0" />
                {overlay}
              </FloatCard>
            ) : (
              <div className="absolute inset-0 rounded-card overflow-hidden border border-line bg-surface2" aria-hidden="true">
                {dish.photo ? (
                  <img src={dish.photo} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" draggable={false} />
                ) : (
                  <CategoryArt category={dish.category} />
                )}
                {overlay}
              </div>
            )}
          </motion.div>
        );
      })}
      {cards.length > 1 && <p className="text-center text-faint text-[12px] mt-2">Drag the card for more</p>}
    </div>
  );
}
