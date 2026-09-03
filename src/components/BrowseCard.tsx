import { useEffect } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { LIQUID_SPRING } from "../motion";

const SWIPE_THRESHOLD = 90;

// Same "pops out of the screen and you swipe through it" physics as
// SwipeCard (used for the Yeah/Nah duel), but for browsing a full result
// set instead of judging one dish: swipe left for the next option, right
// for the previous one — a stack of real results, not a flat scroll list.
export default function BrowseCard({
  cardKey,
  onSwipeNext,
  onSwipePrev,
  canNext,
  canPrev,
  children,
  className = "",
}: {
  cardKey: string;
  onSwipeNext: () => void;
  onSwipePrev: () => void;
  canNext: boolean;
  canPrev: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-8, 8]);
  const nextOpacity = useTransform(x, [-120, -20], [1, 0]);
  const prevOpacity = useTransform(x, [20, 120], [0, 1]);

  useEffect(() => {
    x.set(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  function handleDragEnd(_: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    const past = Math.abs(info.offset.x) > SWIPE_THRESHOLD || Math.abs(info.velocity.x) > 700;
    const dir = info.offset.x < 0 ? "next" : "prev";
    const blocked = (dir === "next" && !canNext) || (dir === "prev" && !canPrev);

    if (!past || blocked) {
      animate(x, 0, LIQUID_SPRING);
      return;
    }
    const flyTo = dir === "next" ? -500 : 500;
    animate(x, flyTo, { ...LIQUID_SPRING, stiffness: 90 }).then(() => (dir === "next" ? onSwipeNext() : onSwipePrev()));
  }

  return (
    <motion.div
      drag="x"
      dragElastic={0.6}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      style={{ x, rotate }}
      initial={{ scale: 0.94, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={LIQUID_SPRING}
      className={`relative cursor-grab active:cursor-grabbing touch-none ${className}`}
    >
      {canNext && (
        <motion.span style={{ opacity: nextOpacity }} className="absolute top-3 right-3 z-10 text-accent text-lg pointer-events-none">
          ›
        </motion.span>
      )}
      {canPrev && (
        <motion.span style={{ opacity: prevOpacity }} className="absolute top-3 left-3 z-10 text-accent text-lg pointer-events-none">
          ‹
        </motion.span>
      )}
      {children}
    </motion.div>
  );
}
