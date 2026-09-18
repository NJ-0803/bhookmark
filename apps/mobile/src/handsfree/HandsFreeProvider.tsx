import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { Easing, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import HandsFree from '../../modules/hands-free';
import { USING_LOCAL_API } from '../api/config';
import { GestureRecognizer, headOffset, type GestureEvent } from './gestures';

// Hands-free mode: Bhookmark's signature feature. Off by default; while it's on
// and the app is in the foreground, the front camera tracks the user's head
// (window-style depth on open dishes) and hand (open-palm air swipes, a
// pointing-finger rating dial). Everything runs on the phone; no image is
// stored or sent anywhere.

const ENABLED_KEY = 'bhookmark.handsFree';
const INTRO_KEY = 'bhookmark.handsFreeIntroSeen';

export type HandsFreeStatus = 'unavailable' | 'off' | 'starting' | 'on' | 'denied' | 'error';
/** What the camera sees of the hand right now: nothing, a hand, or one of the two gesture shapes. */
export type HandSight = 'none' | 'hand' | 'open' | 'point';

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
   * Gesture listeners run newest-first; a listener that returns true consumes
   * the event, so an open panel or the rating screen takes priority over the
   * list behind it.
   */
  subscribe: (listener: Listener) => () => void;
  /** Turns face detection on while something needs head position; call the returned function to release it. */
  requestHeadTracking: () => () => void;
};

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
  const missedHandFrames = useRef(0);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const listeners = useRef<Listener[]>([]);
  const recognizer = useRef(new GestureRecognizer());
  const headUsers = useRef(0);
  const headX = useSharedValue(0);
  const headY = useSharedValue(0);
  const faceVisible = useSharedValue(false);

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
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Run the camera only while enabled and in the foreground.
  useEffect(() => {
    if (!available || !enabled || !appActive) {
      if (available) {
        HandsFree!.stop().catch(() => {});
        setStatus('off');
      }
      recognizer.current.reset();
      setHandSight('none');
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
      const before = recognizer.current.currentPose;
      const events = recognizer.current.update(frame.t, frame.hand);
      // Hand feedback: a single missed frame doesn't blank it, so it doesn't flicker.
      if (frame.hand) missedHandFrames.current = 0;
      else missedHandFrames.current++;
      const pose = recognizer.current.currentPose;
      setHandSight(frame.hand ? (pose === 'other' ? 'hand' : pose) : missedHandFrames.current >= 3 ? 'none' : (prev) => prev);
      // Test builds only: a trace for tuning thresholds on a real hand.
      if (USING_LOCAL_API) {
        // Raw landmarks, so real hand recordings can be replayed off-device (scripts/gestures-replay.ts).
        const r3 = (v: number) => Math.round(v * 1000) / 1000;
        const f = frame.face ? [r3(frame.face.x), r3(frame.face.y), r3(frame.face.w)] : null;
        // age: ms from the camera capturing this frame to it reaching JS.
        // queued: capture → analyser; cost: per stage; bridge: native send → JS.
        const now = Date.now();
        const age = frame.wall ? Math.round(now - frame.wall) : null;
        const bridge = frame.sent ? Math.round(now - frame.sent) : null;
        const queued = frame.queued != null ? Math.round(frame.queued) : null;
        const cost = frame.cost?.map((v) => Math.round(v));
        console.log(`[hfraw] ${JSON.stringify({ t: Math.round(frame.t), age, queued, bridge, gpu: frame.gpu, cost, f, h: frame.hand?.map(r3) ?? null })}`);
        const after = recognizer.current.currentPose;
        if (after !== before) console.log(`[hf] pose ${before} -> ${after}`);
        for (const e of events) console.log(`[hf] ${JSON.stringify(e)}`);
      }
      for (const event of events) {
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
  }, [available, enabled, appActive, headX, headY, faceVisible]);

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
    return () => {
      if (--headUsers.current === 0) HandsFree!.setFaceTracking(false);
    };
  }, [available]);

  const value = useMemo(
    () => ({ available, enabled, status, error, setEnabled, introSeen, markIntroSeen, showIntro, headX, headY, faceVisible, subscribe, requestHeadTracking }),
    [available, enabled, status, error, setEnabled, introSeen, markIntroSeen, showIntro, headX, headY, faceVisible, subscribe, requestHeadTracking],
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
