import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { DishEntry } from "../types";
import { FloatCard, FloatMedia } from "./CardStage";
import { LIQUID_SPRING } from "../motion";

export interface StackCard {
  dish: DishEntry;
  badge: string;
}

/** A compact fanned stack: drag the front card to cycle, tap it to lift it
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
    <div className="relative mb-6" style={{ paddingBottom: "calc(47.6% + 32px)" }}>
      {visible.map(({ dish, badge }, stackPos) => {
        const isFront = stackPos === 0;
        const id = `stack-${dish.id}`;
        const overlay = (
          <>
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
            <span className="absolute top-3 left-3 text-[9px] font-mono uppercase tracking-[0.14em] text-ink/85 bg-black/60 border border-line rounded px-1.5 py-0.5">
              {badge}
            </span>
            <div className="absolute inset-0 flex flex-col justify-end items-start p-3.5">
              <span className="dish-name text-[16px] text-white">{dish.name}</span>
              <span className="text-white/60 text-[11px] mt-1.5">
                {dish.venue} · {dish.area}
              </span>
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
            animate={{ scale: 1 - stackPos * 0.04, y: stackPos * 8, opacity: 1 - stackPos * 0.3 }}
            transition={LIQUID_SPRING}
            style={{ zIndex: 10 - stackPos, touchAction: isFront ? "pan-y" : undefined }}
            className="absolute inset-x-0 aspect-[21/10] cursor-grab active:cursor-grabbing"
          >
            {isFront ? (
              <FloatCard
                id={id}
                label={dish.name}
                className="absolute inset-0 bg-surface2 border border-line"
                contentClassName="absolute inset-0"
                panel={() => renderPanel(dish, `${id}-media`)}
              >
                <FloatMedia id={`${id}-media`} photo={dish.photo} seed={dish.category} className="absolute inset-0" />
                {overlay}
              </FloatCard>
            ) : (
              <div className="absolute inset-0 rounded-card overflow-hidden border border-line bg-surface2">
                {dish.photo && (
                  <img src={dish.photo} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ filter: "saturate(0.8)" }} loading="lazy" draggable={false} />
                )}
                {overlay}
              </div>
            )}
          </motion.div>
        );
      })}
      {cards.length > 1 && (
        <p className="absolute bottom-0 inset-x-0 text-center text-faint text-[10.5px]">Drag to see more</p>
      )}
    </div>
  );
}
