import { useState } from "react";
import { motion } from "framer-motion";
import CravingRoom from "./CravingRoom";
import FoodCircles from "./FoodCircles";
import RemixableLists from "./RemixableLists";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";

type SubTab = "room" | "circles" | "lists";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "room", label: "Craving Room" },
  { id: "circles", label: "Food Circles" },
  { id: "lists", label: "Lists" },
];

export default function Circles() {
  const [sub, setSub] = useState<SubTab>("room");

  return (
    <div>
      <div className="px-5 pt-8 pb-2 flex gap-2 overflow-x-auto">
        {SUB_TABS.map((t) => (
          <motion.button
            key={t.id}
            onClick={() => setSub(t.id)}
            whileTap={TAP_SCALE}
            transition={LIQUID_SPRING}
            className={`relative shrink-0 text-xs font-medium px-3.5 py-2 rounded-full border ${
              sub === t.id ? "text-accentInk border-accent" : "bg-surface border-line text-muted"
            }`}
          >
            {sub === t.id && (
              <motion.div layoutId="circles-sub-pill" transition={LIQUID_SPRING} className="absolute inset-0 bg-accent rounded-full -z-10" />
            )}
            {t.label}
          </motion.button>
        ))}
      </div>
      <motion.div
        key={sub}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={LIQUID_SPRING}
      >
        {sub === "room" && <CravingRoom />}
        {sub === "circles" && <FoodCircles />}
        {sub === "lists" && <RemixableLists />}
      </motion.div>
    </div>
  );
}
