import { motion } from "framer-motion";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";
import { haptic } from "../haptics";

export type Tab = "home" | "bhookmarks" | "circles" | "profile";

const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "Crave" },
  { id: "bhookmarks", label: "Bhookmarks" },
  { id: "circles", label: "Circles" },
  { id: "profile", label: "You" },
];

function TabIcon({ tab }: { tab: Tab }) {
  const props = {
    viewBox: "0 0 24 24",
    className: "w-[19px] h-[19px]",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (tab === "home") {
    return (
      <svg {...props}>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4 4" />
      </svg>
    );
  }
  if (tab === "bhookmarks") {
    return (
      <svg {...props}>
        <path d="M7 3.5h10a1 1 0 0 1 1 1V20l-6-3.6L6 20V4.5a1 1 0 0 1 1-1z" />
      </svg>
    );
  }
  if (tab === "circles") {
    return (
      <svg {...props}>
        <circle cx="9" cy="12" r="5" />
        <circle cx="15" cy="12" r="5" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" />
    </svg>
  );
}

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
      <div className="relative flex items-end justify-between px-3 pb-2.5 pt-2 bg-bg/75 backdrop-blur-md border border-line rounded-[26px] shadow-lift">
        {TABS.slice(0, 2).map((t) => (
          <NavItem key={t.id} tab={t} active={active === t.id} onClick={() => onChange(t.id)} />
        ))}

        <motion.button
          layoutId="bitelog-fab"
          onClick={() => {
            haptic("medium");
            onBite();
          }}
          whileTap={TAP_SCALE}
          transition={LIQUID_SPRING}
          className="gradient-primary relative -top-4 w-12 h-12 rounded-full text-accentInk flex items-center justify-center border border-accent shadow-[0_10px_24px_-10px_rgba(0,0,0,0.9)]"
          aria-label="Log a bite"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
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
  tab: { id: Tab; label: string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={() => {
        haptic("light");
        onClick();
      }}
      whileTap={TAP_SCALE}
      transition={LIQUID_SPRING}
      className="relative flex flex-col items-center gap-1 w-14 py-1.5"
    >
      {active && (
        <motion.div
          layoutId="nav-active-pill"
          transition={LIQUID_SPRING}
          className="absolute inset-0 bg-surface2 rounded-2xl -z-10"
        />
      )}
      <span className={active ? "text-rose" : "text-faint"}>
        <TabIcon tab={tab.id} />
      </span>
      <span className={`text-[10px] ${active ? "text-ink" : "text-faint"}`}>{tab.label}</span>
    </motion.button>
  );
}
