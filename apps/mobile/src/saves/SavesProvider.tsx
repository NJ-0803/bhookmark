import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getSaves, saveDish, unsaveDish, type SavedDish } from '../api/client';

// Saved for later, as on the web (src/saves.tsx): private per-user bookmarks,
// toggled optimistically and rolled back if the server refuses.

export type SaveInput = Omit<SavedDish, 'savedAt'>;

const keyOf = (name: string, venue: string) => `${name.trim().toLowerCase()}|${venue.trim().toLowerCase()}`;

type SavesContextValue = {
  saves: SavedDish[];
  loading: boolean;
  error: string | null;
  isSaved: (name: string, venue: string) => boolean;
  /** Resolves true when the server accepted the change. */
  toggle: (dish: SaveInput) => Promise<boolean>;
  refresh: () => Promise<void>;
};

const SavesContext = createContext<SavesContextValue | null>(null);

export function SavesProvider({ children }: { children: ReactNode }) {
  const [saves, setSaves] = useState<SavedDish[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const savesRef = useRef<SavedDish[]>([]);
  const pending = useRef(new Set<string>());

  const apply = useCallback((update: (prev: SavedDish[]) => SavedDish[]) => {
    setSaves((prev) => {
      const next = update(prev);
      savesRef.current = next;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    const res = await getSaves();
    if (res.ok && 'saves' in res) {
      apply(() => res.saves);
      setError(null);
    } else {
      setError(res.error ?? "Couldn't load your saved dishes.");
    }
    setLoading(false);
  }, [apply]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isSaved = useCallback((name: string, venue: string) => saves.some((s) => keyOf(s.name, s.venue) === keyOf(name, venue)), [saves]);

  const toggle = useCallback(
    async (dish: SaveInput) => {
      const key = keyOf(dish.name, dish.venue);
      if (pending.current.has(key)) return false;
      pending.current.add(key);
      const original = savesRef.current.find((s) => keyOf(s.name, s.venue) === key);
      const wasSaved = !!original;

      apply((prev) =>
        wasSaved ? prev.filter((s) => keyOf(s.name, s.venue) !== key) : [{ ...dish, savedAt: Date.now() }, ...prev],
      );
      const res = wasSaved ? await unsaveDish(dish.name, dish.venue) : await saveDish(dish);
      pending.current.delete(key);

      if (!res.ok) {
        apply((prev) => {
          const without = prev.filter((s) => keyOf(s.name, s.venue) !== key);
          return wasSaved && original ? [original, ...without] : without;
        });
        setError(res.error ?? "Couldn't update your saved dishes. Try again.");
        return false;
      }
      setError(null);
      return true;
    },
    [apply],
  );

  const value = useMemo(() => ({ saves, loading, error, isSaved, toggle, refresh }), [saves, loading, error, isSaved, toggle, refresh]);
  return <SavesContext.Provider value={value}>{children}</SavesContext.Provider>;
}

/** For decoration that may render outside SavesProvider (MotionLab): null there. */
export function useSavesOptional(): SavesContextValue | null {
  return useContext(SavesContext);
}

export function useSaves(): SavesContextValue {
  const ctx = useContext(SavesContext);
  if (!ctx) throw new Error('useSaves must be used inside SavesProvider');
  return ctx;
}
