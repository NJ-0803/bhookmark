import { motion } from "framer-motion";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";

export type Tab = "home" | "palate" | "circles" | "profile";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Crave", icon: "🔍" },
  { id: "palate", label: "Palate", icon: "📓" },
  { id: "circles", label: "Circles", icon: "👥" },
  { id: "profile", label: "You", icon: "◎" },
];

export default function BottomNav({
  active,
  onChange,
  onBite,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  onBite: () => void;
}) {
  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[460px] z-40 px-4 pb-4 bg-bg">
      <div className="relative flex items-end justify-between px-3 pb-3 pt-2.5 bg-bg/70 backdrop-blur-xl border border-line rounded-[28px] shadow-lift">
        {TABS.slice(0, 2).map((t) => (
          <NavItem key={t.id} tab={t} active={active === t.id} onClick={() => onChange(t.id)} />
        ))}

        <motion.button
          layoutId="bitelog-fab"
          onClick={onBite}
          whileHover={{ scale: 1.04 }}
          whileTap={TAP_SCALE}
          transition={LIQUID_SPRING}
          className="relative -top-5 w-14 h-14 rounded-full bg-accent text-accentInk text-2xl font-bold flex items-center justify-center shadow-[0_0_24px_rgba(47,214,196,0.45)]"
          aria-label="Log a bite"
        >
          +
        </motion.button>

        {TABS.slice(2).map((t) => (
          <NavItem key={t.id} tab={t} active={active === t.id} onClick={() => onChange(t.id)} />
        ))}
      </div>
    </div>
  );
}

function NavItem({
  tab,
  active,
  onClick,
}: {
  tab: { id: Tab; label: string; icon: string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={TAP_SCALE}
      transition={LIQUID_SPRING}
      className="relative flex flex-col items-center gap-1 w-14 py-1 text-[11px] font-medium"
    >
      {active && (
        <motion.div
          layoutId="nav-active-pill"
          transition={LIQUID_SPRING}
          className="absolute inset-0 bg-surface2 rounded-2xl -z-10"
        />
      )}
      <span className={`text-lg leading-none transition-colors ${active ? "" : "opacity-70"}`}>{tab.icon}</span>
      <span className={active ? "text-accent" : "text-faint"}>{tab.label}</span>
    </motion.button>
  );
}
