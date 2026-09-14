import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getSaves, saveDish, unsaveDish, type SavedDish } from "./api";
import { DISHES, categoryVisual } from "./data/dishes";
import type { Category, DishEntry } from "./types";
import { haptic } from "./haptics";
import { LIQUID_SPRING } from "./motion";

export type SaveInput = Omit<SavedDish, "savedAt">;

/** A refusal the server explained (e.g. the save limit), as opposed to a
 * network failure, whose raw browser message isn't fit to show. */
class SaveRefused extends Error {}

// Must match the server's savedDishKey (server/src/db.ts).
function keyOf(name: string, venue: string): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return `${norm(name)}|${norm(venue)}`;
}

/** The photographed catalog's own photo for this exact dish at this venue. */
export function catalogPhoto(name: string, venue: string): string | undefined {
  const key = keyOf(name, venue);
  return DISHES.find((d) => d.photo && keyOf(d.name, d.venue) === key)?.photo;
}

export function savedToDishEntry(s: SavedDish): DishEntry {
  const visual = categoryVisual(s.category);
  return {
    id: `saved:${keyOf(s.name, s.venue)}`,
    category: s.category as Category,
    subtype: s.subtype || "General",
    name: s.name,
    venue: s.venue,
    area: s.area,
    emoji: visual.emoji,
    tint: visual.tint,
    score: 0,
    verifiedPct: 0,
    logCount: 0,
    priceRs: 0,
    tasteNotes: [],
    allergens: [],
    photo: catalogPhoto(s.name, s.venue),
  };
}

interface SavesValue {
  saves: SavedDish[];
  isSaved: (name: string, venue: string) => boolean;
  toggle: (dish: SaveInput) => Promise<void>;
}

const SavesContext = createContext<SavesValue>({ saves: [], isSaved: () => false, toggle: async () => {} });

export function useSaves() {
  return useContext(SavesContext);
}

/** Saved-for-later state for the signed-in person: loaded once, toggled
 * optimistically, rolled back (with a visible message) if the server says no. */
export function SavesProvider({ children }: { children: ReactNode }) {
  const [saves, setSaves] = useState<SavedDish[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const savesRef = useRef<SavedDish[]>([]);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    savesRef.current = saves;
  }, [saves]);

  useEffect(() => {
    getSaves()
      .then((res) => {
        if (res.ok) setSaves(res.saves);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(t);
  }, [notice]);

  const keys = useMemo(() => new Set(saves.map((s) => keyOf(s.name, s.venue))), [saves]);
  const isSaved = useCallback((name: string, venue: string) => keys.has(keyOf(name, venue)), [keys]);

  const toggle = useCallback(async (dish: SaveInput) => {
    const key = keyOf(dish.name, dish.venue);
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    const previous = savesRef.current.find((s) => keyOf(s.name, s.venue) === key);
    const without = (list: SavedDish[]) => list.filter((s) => keyOf(s.name, s.venue) !== key);
    haptic("light");

    if (previous) {
      setSaves(without);
    } else {
      setSaves((list) => [{ ...dish, savedAt: Date.now() }, ...without(list)]);
    }

    try {
      if (previous) {
        const res = await unsaveDish(dish.name, dish.venue);
        if (!res.ok) throw new SaveRefused(res.error ?? "");
        setNotice(`Removed ${dish.name} from saved`);
      } else {
        const res = await saveDish(dish);
        if (!res.ok || !res.save) throw new SaveRefused(res.error ?? "");
        const confirmed = res.save;
        setSaves((list) => [confirmed, ...without(list)]);
        setNotice(`Saved ${dish.name} for later`);
      }
    } catch (e) {
      setSaves((list) => (previous ? [...without(list), previous].sort((a, b) => b.savedAt - a.savedAt) : without(list)));
      setNotice(e instanceof SaveRefused && e.message ? e.message : "Couldn't update your saved dishes. Check your connection and try again.");
    } finally {
      inFlight.current.delete(key);
    }
  }, []);

  const value = useMemo(() => ({ saves, isSaved, toggle }), [saves, isSaved, toggle]);

  return (
    <SavesContext.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="fixed inset-x-0 bottom-28 z-[70] flex justify-center px-4 pointer-events-none">
        <AnimatePresence>
          {notice && (
            <motion.p
              key={notice}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={LIQUID_SPRING}
              className="max-w-[420px] rounded-full bg-ink text-bg text-[14px] px-4 py-2.5 shadow-lift"
            >
              {notice}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </SavesContext.Provider>
  );
}
