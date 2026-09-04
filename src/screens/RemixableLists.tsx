import { useState } from "react";
import { motion } from "framer-motion";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";

const SEED_LISTS = [
  { id: "l1", title: "Best late-night dosas under ₹150", author: "Aish", clones: 214, items: ["Set Dosa · Vidyarthi Bhavan", "Idli Vada · Brahmin's Coffee Bar"], accent: "bg-amber-400 text-amber-950" },
  { id: "l2", title: "Dates that did not deserve dessert", author: "Rohan", clones: 89, items: ["Veg Biryani · Nagarjuna"], accent: "bg-orange-600 text-orange-50" },
  { id: "l3", title: "Bangalore filter coffee starter pack", author: "Navtej", clones: 312, items: ["Degree Coffee · Vidyarthi Bhavan", "Cold Filter Coffee · Third Wave"], accent: "bg-amber-800 text-amber-50" },
];

export default function RemixableLists() {
  const [reacted, setReacted] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setReacted((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="px-5 pt-6 pb-32">
      <p className="text-muted text-sm mb-5">Clone a list, reorder it your way, or add one counter-pick — the list stays theirs, your remix is yours.</p>
      <div className="flex flex-col gap-3">
        {SEED_LISTS.map((l, i) => (
          <motion.div
            key={l.id}
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: "-40px" }}
            whileTap={{ scale: 0.98 }}
            transition={{ ...LIQUID_SPRING, delay: Math.min(i, 4) * 0.05 }}
            className="relative bg-surface border border-line rounded-card p-4 pl-5 overflow-hidden"
          >
            <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${l.accent}`} />
            <div className="flex items-start justify-between gap-2 mb-0.5">
              <div className="font-display font-bold text-base">{l.title}</div>
              <span className={`shrink-0 font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full tabular ${l.accent}`}>{l.clones} clones</span>
            </div>
            <div className="text-faint text-xs mb-3">by {l.author}</div>
            <ul className="flex flex-col gap-1 mb-3">
              {l.items.map((item) => (
                <li key={item} className="text-sm text-ink/85">· {item}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <motion.button whileTap={TAP_SCALE} transition={LIQUID_SPRING} className="flex-1 bg-accent text-accentInk text-xs font-semibold rounded-lg py-2">
                Clone this list
              </motion.button>
              <motion.button
                whileTap={TAP_SCALE}
                transition={LIQUID_SPRING}
                onClick={() => toggle(l.id)}
                className={`px-3 rounded-lg text-xs font-medium border ${reacted.has(l.id) ? "bg-accentDim text-accent border-accent/40" : "bg-surface2 border-line text-muted"}`}
              >
                + Counter-pick
              </motion.button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
