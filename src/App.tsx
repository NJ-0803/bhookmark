import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import BottomNav, { type Tab } from "./components/BottomNav";
import Home from "./screens/Home";
import Bhookmarks from "./screens/Bhookmarks";
import Circles from "./screens/Circles";
import Profile from "./screens/Profile";
import LogFlow from "./screens/LogFlow";
import Login from "./screens/Login";
import Onboarding, { ONBOARDING_KEY } from "./screens/Onboarding";
import { DISHES } from "./data/dishes";
import type { DishEntry, JournalLog } from "./types";
import { getMyLogs, getSession, type RemoteLog } from "./api";
import { LIQUID_SPRING } from "./motion";
import { CardStageProvider, StageShell } from "./components/CardStage";
import { SavesProvider } from "./saves";

export default function App() {
  const [authed, setAuthed] = useState(() => !!getSession());
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem(ONBOARDING_KEY));
  const [tab, setTab] = useState<Tab>("home");
  const [extraDishes, setExtraDishes] = useState<DishEntry[]>([]);
  const [logFlow, setLogFlow] = useState<{ open: boolean; prefill?: DishEntry }>({ open: false });
  const [remoteLogs, setRemoteLogs] = useState<RemoteLog[] | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);

  async function refreshLogs() {
    try {
      const res = await getMyLogs();
      if (res.ok) {
        setRemoteLogs(res.logs);
        setLogsError(null);
      } else {
        setLogsError(res.error ?? "Couldn't load your Bhookmarks.");
      }
    } catch {
      setLogsError("Can't reach the Bhookmark API — is the backend running on :4001?");
    }
  }

  useEffect(() => {
    if (authed) refreshLogs();
  }, [authed]);

  function dishLookup(id: string): DishEntry | undefined {
    return DISHES.find((d) => d.id === id) ?? extraDishes.find((d) => d.id === id);
  }

  function handleComplete(_log: JournalLog, dish: DishEntry) {
    if (!dishLookup(dish.id)) setExtraDishes((prev) => [...prev, dish]);
    refreshLogs();
  }

  if (!authed) return <Login onSignedIn={() => setAuthed(true)} />;
  if (showOnboarding) return <Onboarding onDone={() => setShowOnboarding(false)} />;

  // SavesProvider wraps CardStageProvider: floating panels render through the
  // stage's portal, and their Save buttons need the saves context.
  return (
    <SavesProvider>
    <CardStageProvider>
    <div className="min-h-dvh">
      <StageShell>
      <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={LIQUID_SPRING}
        // Home lays itself out across the desktop width; every other screen
        // keeps a capped reading column.
        className={tab === "home" ? "" : "lg:max-w-[620px] lg:mx-auto"}
      >
        {tab === "home" && <Home onLogDish={(dish) => setLogFlow({ open: true, prefill: dish })} />}
        {tab === "bhookmarks" && (
          <Bhookmarks
            logs={remoteLogs}
            logsError={logsError}
            onLogFirst={() => setLogFlow({ open: true })}
            onLogDish={(dish) => setLogFlow({ open: true, prefill: dish })}
          />
        )}
        {tab === "circles" && <Circles />}
        {tab === "profile" && (
          <Profile logs={remoteLogs ?? []} onSignOut={() => setAuthed(false)} onLogFirst={() => setLogFlow({ open: true })} />
        )}
      </motion.div>
      </AnimatePresence>
      </StageShell>

      <BottomNav active={tab} onChange={setTab} onBite={() => setLogFlow({ open: true })} />

      <AnimatePresence>
        {logFlow.open && (
          <LogFlow
            prefillDish={logFlow.prefill}
            onClose={() => setLogFlow({ open: false })}
            onComplete={handleComplete}
          />
        )}
      </AnimatePresence>
    </div>
    </CardStageProvider>
    </SavesProvider>
  );
}
