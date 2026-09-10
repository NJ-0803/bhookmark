import { useEffect } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { LIQUID_SPRING } from "../motion";

const SWIPE_THRESHOLD = 110;

export default function SwipeCard({
  cardKey,
  onSwipeRight,
  onSwipeLeft,
  rightLabel = "YEAH",
  leftLabel = "NAH",
  children,
  className = "",
}: {
  cardKey: string;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  rightLabel?: string;
  leftLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-14, 14]);
  const rightOpacity = useTransform(x, [20, 120], [0, 1]);
  const leftOpacity = useTransform(x, [-120, -20], [1, 0]);

  useEffect(() => {
    x.set(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  function handleDragEnd(_: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    const past = Math.abs(info.offset.x) > SWIPE_THRESHOLD || Math.abs(info.velocity.x) > 800;
    if (!past) {
      animate(x, 0, LIQUID_SPRING);
      return;
    }
    const dir = info.offset.x > 0 ? 1 : -1;
    animate(x, dir * 600, { ...LIQUID_SPRING, stiffness: 90 }).then(() => (dir > 0 ? onSwipeRight() : onSwipeLeft()));
  }

  return (
    <motion.div
      drag="x"
      dragElastic={1}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      initial={{ scale: 0.94, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={LIQUID_SPRING}
      // V01: see BrowseCard's comment — touch-none blocked native vertical
      // scroll entirely on this card.
      style={{ x, rotate, touchAction: "pan-y" }}
      className={`relative cursor-grab active:cursor-grabbing ${className}`}
    >
      <motion.span style={{ opacity: rightOpacity }} className="absolute top-4 right-4 z-10 text-accent border-2 border-accent rounded-lg px-3 py-1 text-sm font-bold rotate-6 pointer-events-none">
        {rightLabel}
      </motion.span>
      <motion.span style={{ opacity: leftOpacity }} className="absolute top-4 left-4 z-10 text-bad border-2 border-bad rounded-lg px-3 py-1 text-sm font-bold -rotate-6 pointer-events-none">
        {leftLabel}
      </motion.span>
      {children}
    </motion.div>
  );
}
