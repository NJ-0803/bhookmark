import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { QualityTier } from './policy';

const REDUCE_KEY = 'bhookmark.reduceEffects';
const HAPTICS_KEY = 'bhookmark.haptics';

type MotionContextValue = {
  /** OS Reduce Motion, followed live. */
  systemReduce: boolean;
  /** In-app "Reduce effects" setting. */
  reduceEffects: boolean;
  setReduceEffects: (on: boolean) => void;
  hapticsEnabled: boolean;
  setHapticsEnabled: (on: boolean) => void;
  /** Performance ceiling; lowered to 'standard' only after sustained missed deadlines (Step 5). */
  performanceTier: Exclude<QualityTier, 'reduced'>;
  setPerformanceTier: (tier: Exclude<QualityTier, 'reduced'>) => void;
  tier: QualityTier;
  /** MotionLab only, not persisted: stretches flights so the choreography can be inspected. 1 = real speed. */
  slowMotion: number;
  setSlowMotion: (factor: number) => void;
};

const MotionContext = createContext<MotionContextValue | null>(null);

export function MotionProvider({ children }: { children: ReactNode }) {
  // Calm until the OS answers, so a Reduce Motion user never sees a zoom first.
  const [systemReduce, setSystemReduce] = useState(true);
  const [reduceEffects, setReduceState] = useState(false);
  const [hapticsEnabled, setHapticsState] = useState(true);
  const [performanceTier, setPerformanceTier] = useState<Exclude<QualityTier, 'reduced'>>('full');
  const [slowMotion, setSlowMotion] = useState(1);

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (live) setSystemReduce(v);
      })
      .catch(() => {
        if (live) setSystemReduce(false);
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduce);
    AsyncStorage.multiGet([REDUCE_KEY, HAPTICS_KEY])
      .then(([[, reduce], [, haptics]]) => {
        if (!live) return;
        if (reduce === '1') setReduceState(true);
        if (haptics === '0') setHapticsState(false);
      })
      .catch(() => {});
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  const setReduceEffects = useCallback((on: boolean) => {
    setReduceState(on);
    AsyncStorage.setItem(REDUCE_KEY, on ? '1' : '0').catch(() => {});
  }, []);

  const setHapticsEnabled = useCallback((on: boolean) => {
    setHapticsState(on);
    AsyncStorage.setItem(HAPTICS_KEY, on ? '1' : '0').catch(() => {});
  }, []);

  const tier: QualityTier = systemReduce || reduceEffects ? 'reduced' : performanceTier;

  const value = useMemo(
    () => ({
      systemReduce,
      reduceEffects,
      setReduceEffects,
      hapticsEnabled,
      setHapticsEnabled,
      performanceTier,
      setPerformanceTier,
      tier,
      slowMotion,
      setSlowMotion,
    }),
    [systemReduce, reduceEffects, setReduceEffects, hapticsEnabled, setHapticsEnabled, performanceTier, tier, slowMotion],
  );
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotion(): MotionContextValue {
  const ctx = useContext(MotionContext);
  if (!ctx) throw new Error('useMotion must be used inside MotionProvider');
  return ctx;
}
