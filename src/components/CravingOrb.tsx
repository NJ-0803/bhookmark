import { useEffect } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

// The one deliberate "hero" depth moment on the whole app (brief: ~90% DOM,
// ~10% depth — spend it in one place, not everywhere). Built with CSS +
// Framer Motion instead of a real WebGL/R3F scene: a phone-first food app
// doesn't need a three.js runtime, a GPU budget, or a static-fallback story
// to get "a glowing thing that reacts to you" — this gets ~90% of the felt
// effect for none of the bundle-size or battery cost, and respects
// prefers-reduced-motion for free via useReducedMotion().
const ORB_COLORS: Record<string, [string, string]> = {
  default: ["#E1122E", "#5A0008"],
  "Dosa & Idli": ["#FF4D3D", "#8B0000"],
  Biryani: ["#FF2A3D", "#8B0000"],
  Coffee: ["#B00B1E", "#3A0A06"],
  Burger: ["#FF4D3D", "#5A0008"],
  Pizza: ["#FF2A3D", "#B00B1E"],
  Momos: ["#E1122E", "#8B0000"],
  "Ice Cream": ["#FF8A8A", "#B00B1E"],
};

export default function CravingOrb({ activeCategory }: { activeCategory?: string | null }) {
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 40, damping: 20 });
  const springY = useSpring(y, { stiffness: 40, damping: 20 });
  const rotateX = useTransform(springY, [-30, 30], [6, -6]);
  const rotateY = useTransform(springX, [-30, 30], [-6, 6]);

  useEffect(() => {
    if (reduceMotion) return;
    function handlePointer(e: PointerEvent) {
      const cx = window.innerWidth / 2;
      x.set(Math.max(-30, Math.min(30, (e.clientX - cx) / 8)));
      y.set(Math.max(-20, Math.min(20, (e.clientY - 140) / 10)));
    }
    window.addEventListener("pointermove", handlePointer, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointer);
  }, [x, y, reduceMotion]);

  const [c1, c2] = ORB_COLORS[activeCategory ?? "default"] ?? ORB_COLORS.default;

  return (
    <div className="absolute inset-x-0 top-0 h-64 overflow-hidden pointer-events-none" aria-hidden="true">
      <motion.div
        style={{
          x: reduceMotion ? 0 : springX,
          y: reduceMotion ? 0 : springY,
          rotateX: reduceMotion ? 0 : rotateX,
          rotateY: reduceMotion ? 0 : rotateY,
          background: `radial-gradient(circle, ${c1}55, ${c2}33 55%, transparent 75%)`,
        }}
        animate={reduceMotion ? undefined : { scale: [1, 1.08, 1] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        className="absolute left-1/2 top-2 -translate-x-1/2 w-72 h-72 rounded-full blur-2xl transition-[background] duration-700"
      />
    </div>
  );
}
