import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { Easing, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import HandsFree from '../../modules/hands-free';
import { HandsFreeController, type ControllerOutput } from './controller';
import { headOffset, type GestureEvent } from './gestures';
import { GestureLearner } from './learning';

// Hands-free mode: Bhookmark's signature feature. Off by default; while it's on
// and the app is in the foreground, the front camera tracks the user's head
// (window-style depth on open dishes) and hand (open-palm air swipes, a
// pointing-finger rating dial). Everything runs on the phone; no image is
// stored or sent anywhere.

const ENABLED_KEY = 'bhookmark.handsFree';
// Diagnostics only, set explicitly when starting Metro: EXPO_PUBLIC_HANDSFREE_TRACE=1.
// Logs landmarks and timing for scripts/gestures-replay.ts. Never on by default.
const TRACE = process.env.EXPO_PUBLIC_HANDSFREE_TRACE === '1';
const INTRO_KEY = 'bhookmark.handsFreeIntroSeen';
// How this user gestures, learned on the phone (learning.ts). Never leaves the device.
const LEARNING_KEY = 'bhookmark.handsFreeLearning';
// Earlier snap-only learning (same day), carried over once.
const OLD_SNAP_KEY = 'bhookmark.handsFreeSnapLearning';

export type HandsFreeStatus = 'unavailable' | 'off' | 'starting' | 'on' | 'denied' | 'error';
/** What the controller can do right now: nothing in view, a hand it can't use yet, or which gesture is ready. */
export type HandSight = 'none' | 'hand' | 'ready' | 'point' | 'fist' | 'pyramid' | 'snap' | 'slower' | 'back';

type Listener = (event: GestureEvent) => boolean | void;

type HandsFreeContextValue = {
  /** False where the native module isn't in the build (iOS for now, Expo Go). */
  available: boolean;
  enabled: boolean;
  status: HandsFreeStatus;
  error: string | null;
  /** Turns the mode on (asking for camera access) or off. Resolves to the resulting enabled state. */
  setEnabled: (on: boolean) => Promise<boolean>;
  introSeen: boolean | null;
  markIntroSeen: () => void;
  /** Shows the Hands-free guide again. */
  showIntro: () => void;
  /** Head position, -1…1, smoothed; 0 when no face is seen. */
  headX: SharedValue<number>;
  headY: SharedValue<number>;
  faceVisible: SharedValue<boolean>;
  /**
   * Live swipe preview, -1…1 along each axis (right/down positive): how far
   * the current sweep is towards committing. Reversible; only a committed
   * swipe event may act. Springs back to 0 when a sweep is abandoned.
   */
  previewX: SharedValue<number>;
  previewY: SharedValue<number>;
  /** A touch took over: cancel any gesture in progress. */
  interrupt: () => void;
  /** The user cancelled the snap-to-close: learn that it wasn't meant. */
  cancelSnap: () => void;
  /** Forget everything learned about this user's gestures and go back to the defaults. */
  resetLearning: () => void;
  /** A rating dial is on screen: a pointing finger dials instead of swiping. */
  setDialActive: (on: boolean) => void;
  /**
   * Gesture listeners run newest-first; a listener that returns true consumes
   * the event, so an open panel or the rating screen takes priority over the
   * list behind it.
   */
  subscribe: (listener: Listener) => () => void;
  /** Turns face detection on while something needs head position; call the returned function to release it. */
  requestHeadTracking: () => () => void;
};

function sightOf(out: ControllerOutput): HandSight {
  if (out.pose === 'none') return 'none';
  if (out.state === 'armed' || out.state === 'previewing' || out.state === 'following' || out.state === 'closing') return 'ready';
  if (out.state === 'dial') return 'point';
  if (out.state === 'fist' || out.state === 'opening') return 'fist';
  if (out.state === 'pyramid') return 'pyramid';
  if (out.state === 'snap') return 'snap';
  return 'hand';
}

// Coaching: how long "Slower" shows, and how often at most (a hint, not a nag).
const COACH_MS = 2500;
const COACH_EVERY_MS = 15000;

const HandsFreeContext = createContext<HandsFreeContextValue | null>(null);
// Separate, so a hand entering or leaving view only re-renders the pill.
const HandSightContext = createContext<HandSight>('none');

export function HandsFreeProvider({ children }: { children: ReactNode }) {
  const available = Platform.OS === 'android' && HandsFree != null;
  const [enabled, setEnabledState] = useState(false);
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);
  const [status, setStatus] = useState<HandsFreeStatus>(available ? 'off' : 'unavailable');
  const [error, setError] = useState<string | null>(null);
  const [handSight, setHandSight] = useState<HandSight>('none');
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const listeners = useRef<Listener[]>([]);
  const controller = useRef(new HandsFreeController());
  const learner = useRef(new GestureLearner());
  const saveLearning = useCallback(() => {
    AsyncStorage.setItem(LEARNING_KEY, JSON.stringify(learner.current)).catch(() => {});
  }, []);
  const headUsers = useRef(0);
  const headX = useSharedValue(0);
  const headY = useSharedValue(0);
  const faceVisible = useSharedValue(false);
  const previewX = useSharedValue(0);
  const previewY = useSharedValue(0);
  const coach = useRef<{ until: number; last: number; say: 'slower' | 'back' }>({ until: 0, last: -Infinity, say: 'slower' });

  useEffect(() => {
    AsyncStorage.multiGet([ENABLED_KEY, INTRO_KEY])
      .then(([[, on], [, seen]]) => {
        setIntroSeen(seen === '1');
        if (on === '1' && available) {
          // Only resume if camera access is still granted.
          HandsFree!
            .getPermission()
            .then((p) => setEnabledState(p.granted))
            .catch(() => {});
        }
      })
      .catch(() => setIntroSeen(false));
  }, [available]);

  useEffect(() => {
    AsyncStorage.multiGet([LEARNING_KEY, OLD_SNAP_KEY])
      .then(([[, raw], [, oldSnap]]) => {
        if (raw) learner.current = GestureLearner.from(JSON.parse(raw));
        else if (oldSnap) {
          learner.current.snap.load(JSON.parse(oldSnap));
          AsyncStorage.setItem(LEARNING_KEY, JSON.stringify(learner.current)).catch(() => {});
          AsyncStorage.removeItem(OLD_SNAP_KEY).catch(() => {});
        }
        controller.current.setTuning(learner.current.tuning());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Frames arrive every ~35–60 ms; ease between them so the preview moves on every display frame.
  const publishPreview = useCallback(
    (out: ControllerOutput) => {
      const p = out.preview;
      const x = p?.axis === 'x' ? (p.direction === 'right' ? p.progress : -p.progress) : 0;
      const y = p?.axis === 'y' ? (p.direction === 'down' ? p.progress : -p.progress) : 0;
      const ease = (target: number, v: SharedValue<number>) => {
        if (target !== 0) v.value = withTiming(target, { duration: 60, easing: Easing.linear });
        else if (v.value !== 0) v.value = withSpring(0, { damping: 18, stiffness: 220 });
      };
      ease(x, previewX);
      ease(y, previewY);
    },
    [previewX, previewY],
  );

  // Run the camera only while enabled and in the foreground.
  useEffect(() => {
    if (!available || !enabled || !appActive) {
      if (available) {
        HandsFree!.stop().catch(() => {});
        setStatus('off');
      }
      controller.current.reset();
      setHandSight('none');
      previewX.value = 0;
      previewY.value = 0;
      faceVisible.value = false;
      headX.value = withTiming(0, { duration: 300 });
      headY.value = withTiming(0, { duration: 300 });
      return;
    }
    let live = true;
    setStatus('starting');
    const frameSub = HandsFree!.addListener('onFrame', (frame) => {
      if (frame.face) {
        const o = headOffset(frame.face);
        faceVisible.value = true;
        // Frames arrive ~30/s; ease between them so the depth moves at 60+ fps.
        headX.value = withTiming(o.x, { duration: 40, easing: Easing.linear });
        headY.value = withTiming(o.y, { duration: 40, easing: Easing.linear });
      } else if (faceVisible.value) {
        faceVisible.value = false;
        headX.value = withTiming(0, { duration: 300 });
        headY.value = withTiming(0, { duration: 300 });
      }
      const out = controller.current.update({ t: frame.cap ?? frame.t, w: frame.w, h: frame.h, hand: frame.hand });
      const events = out.events;
      if (out.attempt) {
        learner.current.observe(out.attempt);
        controller.current.setTuning(learner.current.tuning());
        // Saved on every fired gesture (a fired snap closes the app a moment later).
        if (out.attempt.fired) saveLearning();
        if (TRACE) console.log(`[hf] attempt ${JSON.stringify(out.attempt)} → ${JSON.stringify(learner.current.tuning())}`);
      }
      publishPreview(out);
      const now = Date.now();
      const hint = events.find((e) => e.type === 'hint');
      if (hint && now - coach.current.last >= COACH_EVERY_MS) {
        coach.current = { until: now + COACH_MS, last: now, say: hint.hint };
      }
      setHandSight(now < coach.current.until ? coach.current.say : sightOf(out));
      if (TRACE) {
        const r3 = (v: number) => Math.round(v * 1000) / 1000;
        console.log(
          `[hfraw] ${JSON.stringify({
            t: Math.round((frame.cap ?? frame.t) * 10) / 10,
            W: frame.w,
            H: frame.h,
            age: frame.wall != null ? Math.round(now - frame.wall) : null,
            queued: frame.queued != null ? Math.round(frame.queued) : null,
            bridge: frame.sent != null ? Math.round(now - frame.sent) : null,
            d: frame.delegate,
            idle: frame.idle,
            cost: frame.cost?.map((v) => Math.round(v * 10) / 10),
            f: frame.face ? [r3(frame.face.x), r3(frame.face.y), r3(frame.face.w)] : null,
            h: frame.hand?.map(r3) ?? null,
          })}`,
        );
        for (const e of events) console.log(`[hf] ${out.state} ${JSON.stringify(e)}`);
      }
      for (const event of events) {
        if (event.type === 'hint') continue; // shown in the pill, not a gesture
        for (const l of [...listeners.current].reverse()) {
          if (l(event)) break;
        }
      }
    });
    const errorSub = HandsFree!.addListener('onError', (e) => setError(e.message));
    HandsFree!
      .start()
      .then(() => {
        if (live) {
          setStatus('on');
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (live) {
          setStatus('error');
          setError(e.message);
        }
      });
    return () => {
      live = false;
      frameSub.remove();
      errorSub.remove();
      HandsFree!.stop().catch(() => {});
    };
  }, [available, enabled, appActive, headX, headY, faceVisible, previewX, previewY, publishPreview]);

  const setEnabled = useCallback(
    async (on: boolean) => {
      if (!available) return false;
      if (on) {
        const perm = await HandsFree!.requestPermission().catch(() => null);
        if (!perm?.granted) {
          setStatus('denied');
          setError(
            perm && !perm.canAskAgain
              ? 'Camera access is off for Bhookmark. Turn it on in Android Settings → Apps → Bhookmark → Permissions.'
              : 'Hands-free needs the camera to see your hand.',
          );
          return false;
        }
      }
      setError(null);
      setEnabledState(on);
      AsyncStorage.setItem(ENABLED_KEY, on ? '1' : '0').catch(() => {});
      return on;
    },
    [available],
  );

  const markIntroSeen = useCallback(() => {
    setIntroSeen(true);
    AsyncStorage.setItem(INTRO_KEY, '1').catch(() => {});
  }, []);

  const showIntro = useCallback(() => setIntroSeen(false), []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.push(listener);
    return () => {
      listeners.current = listeners.current.filter((l) => l !== listener);
    };
  }, []);

  const requestHeadTracking = useCallback(() => {
    if (!available) return () => {};
    if (headUsers.current++ === 0) HandsFree!.setFaceTracking(true);
    let released = false;
    return () => {
      if (released) return; // idempotent: a second call can't drive the count negative
      released = true;
      headUsers.current = Math.max(0, headUsers.current - 1);
      if (headUsers.current === 0) HandsFree!.setFaceTracking(false);
    };
  }, [available]);

  const interrupt = useCallback(() => {
    controller.current.interrupt();
    previewX.value = withSpring(0, { damping: 18, stiffness: 220 });
    previewY.value = withSpring(0, { damping: 18, stiffness: 220 });
  }, [previewX, previewY]);

  const cancelSnap = useCallback(() => {
    learner.current.cancelLastSnap();
    controller.current.setTuning(learner.current.tuning());
    saveLearning();
  }, [saveLearning]);

  const setDialActive = useCallback((on: boolean) => controller.current.setDialEnabled(on), []);

  const resetLearning = useCallback(() => {
    learner.current = new GestureLearner();
    controller.current.setTuning(learner.current.tuning());
    AsyncStorage.multiRemove([LEARNING_KEY, OLD_SNAP_KEY]).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ available, enabled, status, error, setEnabled, introSeen, markIntroSeen, showIntro, headX, headY, faceVisible, previewX, previewY, interrupt, cancelSnap, resetLearning, setDialActive, subscribe, requestHeadTracking }),
    [available, enabled, status, error, setEnabled, introSeen, markIntroSeen, showIntro, headX, headY, faceVisible, previewX, previewY, interrupt, cancelSnap, resetLearning, setDialActive, subscribe, requestHeadTracking],
  );
  return (
    <HandsFreeContext.Provider value={value}>
      <HandSightContext.Provider value={handSight}>{children}</HandSightContext.Provider>
    </HandsFreeContext.Provider>
  );
}

/** Live feedback for the pill: whether the camera sees a hand, and which gesture shape. */
export function useHandSight(): HandSight {
  return useContext(HandSightContext);
}

export function useHandsFree(): HandsFreeContextValue {
  const ctx = useContext(HandsFreeContext);
  if (!ctx) throw new Error('useHandsFree must be used inside HandsFreeProvider');
  return ctx;
}

/** While `active`, a pointing finger drives the rating dial (elsewhere one finger swipes). */
export function useHandsFreeDial(active: boolean) {
  const { setDialActive } = useHandsFree();
  useEffect(() => {
    if (!active) return;
    setDialActive(true);
    return () => setDialActive(false);
  }, [active, setDialActive]);
}

/** Subscribe to gestures while `active`; return true from the handler to consume an event. */
export function useHandsFreeGestures(active: boolean, handler: Listener) {
  const { subscribe } = useHandsFree();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    return subscribe((e) => ref.current(e));
  }, [active, subscribe]);
}
