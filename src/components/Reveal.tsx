import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { REVEAL_SPRING } from "../motion";

/** Rises 20px and fades in the first time ~15% of the block enters the
 * viewport; never re-hides on scroll up. Plain static block under reduced
 * motion. */
export default function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ ...REVEAL_SPRING, delay }}
    >
      {children}
    </motion.div>
  );
}
