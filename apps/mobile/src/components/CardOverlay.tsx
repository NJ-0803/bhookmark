import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  measure,
  ReduceMotion,
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { RemoteLog } from '../api/client';
import { placeLine } from '../format';
import { useMotion } from '../motion/MotionProvider';
import { effectsFor, flight, flightEasing, flightPeak, limits, timing, type TierEffects } from '../motion/policy';
import { fonts } from '../theme/brand';
import { useTheme } from '../theme/ThemeProvider';
import CategoryArt from './CategoryArt';
import HoloHud from './HoloHud';

// Brief Step 3: a tapped card detaches into one root overlay.
//
// Lifecycle: idle → opening → open → closing → idle, with one active entry
// and a generation counter. Every async completion (measurement, animation
// end) carries the generation it was started with and is ignored if a newer
// transition has begun, so a cancelled close can never remove a reopened
// panel. Closing during opening reverses from the current progress; reopening
// the same card during closing goes forward again; tapping another card while
// one is closing drops the closing one at once.
//
// Flight: the card surface, the photo and the dish name are separate layers,
// each with a travel wrapper (source rect → destination rect, transform-only,
// origin top-left) and an inner wrapper for the bold in-flight effects from
// policy.ts: the surface swings in 3D, the photo pitches, yaws, shears and
// rises past the panel edge under a passing light sweep, the name drifts and
// tips, and a floating shadow grows beneath. The name crossfades between the
// source card's type size and the panel's so neither is stretched or
// re-wrapped. Readable detail content only fades in near arrival. If the
// source card is gone when closing, the panel fades in place instead of
// flying to stale coordinates.

export type OverlayDish = {
  id: string;
  name: string;
  venue: string;
  area: string;
  category: string;
  subtype: string;
  /** A real photo, or null for the category illustration. */
  photo: ImageSourcePropType | null;
  /** Line above the title; defaults to the category. */
  eyebrow?: string;
  /** Present when the card is one of the user's own logs. */
  log?: RemoteLog;
};

export type NameMetrics = { fontSize: number; lineHeight: number };

type Rect = { x: number; y: number; width: number; height: number };
type SourceRects = { card: Rect; photo: Rect; name: Rect };
type Phase = 'idle' | 'opening' | 'open' | 'closing';
type Entry = { dish: OverlayDish; rects: SourceRects; sourceGone: boolean; nameMetrics: NameMetrics; photoRadius: number };

export type SourceRefs = {
  card: AnimatedRef<Animated.View>;
  photo: AnimatedRef<Animated.View>;
  name: AnimatedRef<Animated.View>;
  focus: RefObject<View | null>;
  nameMetrics?: NameMetrics;
  photoRadius?: number;
};

/** Tile card name metrics (the default when a source doesn't say). */
export const CARD_NAME = { fontSize: 17, lineHeight: 20 } as const;
export const CARD_PHOTO_RADIUS = 14;
const PANEL_NAME = { fontSize: 30, lineHeight: 34 } as const;
const PANEL_PHOTO_RADIUS = 16;
const PANEL_RADIUS = 22;

const CONTACT_SHADOW = require('../../assets/motion/contact-shadow.png');

type RenderDetail = (dish: OverlayDish, close: () => void) => ReactNode;

type OverlayContextValue = {
  activeId: string | null;
  phase: Phase;
  entry: Entry | null;
  progress: SharedValue<number>;
  stage: SharedValue<number>;
  fade: SharedValue<number>;
  fx: TierEffects;
  reduce: boolean;
  register: (id: string, refs: SourceRefs) => () => void;
  open: (dish: OverlayDish) => void;
  close: () => void;
  renderDetail?: RenderDetail;
  onDevRemoveSource?: (id: string) => void;
};

const OverlayContext = createContext<OverlayContextValue | null>(null);

export function useCardOverlay(): OverlayContextValue {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error('useCardOverlay must be used inside CardOverlayProvider');
  return ctx;
}

export function CardOverlayProvider({
  children,
  renderDetail,
  onTransitionStart,
  onDevRemoveSource,
}: {
  children: ReactNode;
  /** Content under the title (actions, scores). Without it the panel shows a not-connected placeholder. */
  renderDetail?: RenderDetail;
  /** Called when a flight starts, with its direction and duration (used by the MotionLab probe). */
  onTransitionStart?: (to: 0 | 1, durationMs: number) => void;
  /** MotionLab only: lets the detail remove its own source card to test the fade-in-place close. */
  onDevRemoveSource?: (id: string) => void;
}) {
  const { tier, hapticsEnabled, slowMotion } = useMotion();
  const fx = effectsFor(tier);
  const reduce = tier === 'reduced';

  const progress = useSharedValue(0);
  // Background recession follows the flight, but is animated separately so a
  // fade-in-place close can still return the page to rest.
  const stage = useSharedValue(0);
  const fade = useSharedValue(1);

  const sources = useRef(new Map<string, SourceRefs>());
  const gen = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const entryRef = useRef<Entry | null>(null);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [entry, setEntryState] = useState<Entry | null>(null);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const setEntry = useCallback((next: Entry | null) => {
    entryRef.current = next;
    setEntryState(next);
  }, []);

  const register = useCallback((id: string, refs: SourceRefs) => {
    sources.current.set(id, refs);
    return () => {
      if (sources.current.get(id) === refs) sources.current.delete(id);
    };
  }, []);

  const settle = useCallback(
    (g: number, to: number) => {
      if (g !== gen.current) return;
      if (to === 1) {
        setPhase('open');
        return;
      }
      const closed = entryRef.current;
      setEntry(null);
      setPhase('idle');
      // Return accessibility focus to the card if it still exists.
      const target = closed ? sources.current.get(closed.dish.id)?.focus.current : null;
      if (target) AccessibilityInfo.sendAccessibilityEvent(target, 'focus');
    },
    [setEntry, setPhase],
  );

  const run = useCallback(
    (to: 0 | 1, g: number) => {
      cancelAnimation(progress);
      cancelAnimation(stage);
      const remaining = Math.abs(to - progress.value);
      const base = to === 1 ? timing.open : timing.close;
      const duration = (reduce ? (to === 1 ? 180 : 150) : Math.max(120, base * remaining)) * slowMotion;
      onTransitionStart?.(to, duration);
      const config = {
        duration,
        easing: reduce ? Easing.out(Easing.cubic) : flightEasing,
        reduceMotion: ReduceMotion.System,
      };
      stage.value = withTiming(to, config);
      progress.value = withTiming(to, config, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(settle, g, to);
      });
    },
    [progress, stage, reduce, slowMotion, settle, onTransitionStart],
  );

  const open = useCallback(
    (dish: OverlayDish) => {
      const refs = sources.current.get(dish.id);
      if (!refs) return;

      const current = entryRef.current;
      if (current) {
        if (phaseRef.current !== 'closing') return;
        if (current.dish.id === dish.id && !current.sourceGone) {
          // Reopen during close: go forward again from wherever it is.
          const g = ++gen.current;
          setPhase('opening');
          run(1, g);
          return;
        }
        // A different card while one is closing: drop the closing one now.
        gen.current++;
        cancelAnimation(progress);
        cancelAnimation(stage);
        cancelAnimation(fade);
        progress.value = 0;
        stage.value = 0;
        fade.value = 1;
        setEntry(null);
      }

      const g = ++gen.current;
      setPhase('opening');
      const { card, photo, name } = refs;
      const nameMetrics = refs.nameMetrics ?? CARD_NAME;
      const photoRadius = refs.photoRadius ?? CARD_PHOTO_RADIUS;

      const onMeasured = (rects: SourceRects | null) => {
        if (g !== gen.current) return;
        if (!rects) {
          setPhase('idle');
          return;
        }
        progress.value = 0;
        fade.value = 1;
        setEntry({ dish, rects, sourceGone: false, nameMetrics, photoRadius });
        if (hapticsEnabled) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
        run(1, g);
      };

      // Measure in screen coordinates, the same space the root overlay uses.
      scheduleOnUI(() => {
        'worklet';
        const c = measure(card);
        const p = measure(photo);
        const n = measure(name);
        if (!c || !p || !n) {
          scheduleOnRN(onMeasured, null);
          return;
        }
        scheduleOnRN(onMeasured, {
          card: { x: c.pageX, y: c.pageY, width: c.width, height: c.height },
          photo: { x: p.pageX, y: p.pageY, width: p.width, height: p.height },
          name: { x: n.pageX, y: n.pageY, width: n.width, height: n.height },
        });
      });
    },
    [progress, stage, fade, hapticsEnabled, run, setEntry, setPhase],
  );

  const close = useCallback(() => {
    const current = entryRef.current;
    if (!current || phaseRef.current === 'closing') return;
    const g = ++gen.current;
    setPhase('closing');

    if (!sources.current.has(current.dish.id)) {
      // The source was filtered away: nothing to return to, so fade in place.
      setEntry({ ...current, sourceGone: true });
      cancelAnimation(progress);
      cancelAnimation(stage);
      const duration = (reduce ? 150 : 220) * slowMotion;
      onTransitionStart?.(0, duration);
      stage.value = withTiming(0, { duration, reduceMotion: ReduceMotion.System });
      fade.value = withTiming(0, { duration, reduceMotion: ReduceMotion.System }, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(settle, g, 0);
      });
      return;
    }
    run(0, g);
  }, [progress, stage, fade, reduce, slowMotion, run, settle, setEntry, setPhase, onTransitionStart]);

  // Android Back reaches the same close handler as Close and the backdrop.
  useEffect(() => {
    if (!entry) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [entry, close]);

  const value = useMemo(
    () => ({
      activeId: entry?.dish.id ?? null,
      phase,
      entry,
      progress,
      stage,
      fade,
      fx,
      reduce,
      register,
      open,
      close,
      renderDetail,
      onDevRemoveSource,
    }),
    [entry, phase, progress, stage, fade, fx, reduce, register, open, close, renderDetail, onDevRemoveSource],
  );

  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}

/** The page behind an open panel: recedes and tips away in flight, rests at
 * 0.97, and is hidden from assistive technology while a panel is open. */
export function OverlayStage({ children }: { children: ReactNode }) {
  const { stage, fx, reduce, activeId } = useCardOverlay();
  const style = useAnimatedStyle(() => {
    const s = stage.value;
    const peak = fx.perspective ? flightPeak(s) : 0;
    return {
      transform: [
        { perspective: 1000 },
        { rotateX: `${flight.backgroundRotateXDeg * peak}deg` },
        { scale: reduce ? 1 : 1 - s * (1 - limits.backgroundScale) - flight.backgroundExtraRecede * peak },
      ],
    };
  });
  const hidden = activeId !== null;
  return (
    <Animated.View
      style={[styles.fill, style]}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={hidden}
      // While a panel is open the page behind it doesn't change: cache it as
      // one GPU texture so recession and tilt don't redraw every card.
      renderToHardwareTextureAndroid={hidden}
      shouldRasterizeIOS={hidden}
    >
      {children}
    </Animated.View>
  );
}

/** Mount once, as the last child of a full-screen root at the window origin. */
export function CardOverlayLayer() {
  const { entry } = useCardOverlay();
  if (!entry) return null;
  return <OverlayScene key={entry.dish.id} entry={entry} />;
}

const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};

function OverlayScene({ entry }: { entry: Entry }) {
  const { progress, fade, fx, reduce, phase, close, renderDetail, onDevRemoveSource } = useCardOverlay();
  const { colors: c } = useTheme();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { dish, rects: src, nameMetrics, photoRadius } = entry;

  // Destination geometry, in the same screen coordinates as the source.
  const panelW = Math.min(W - 32, 420);
  const inset = 10;
  const pad = 18;
  const panel: Rect = {
    x: (W - panelW) / 2,
    y: insets.top + 24,
    width: panelW,
    height: 0,
  };
  const photo: Rect = {
    x: panel.x + inset,
    y: panel.y + inset,
    width: panelW - inset * 2,
    height: (panelW - inset * 2) * 0.75,
  };
  panel.height = Math.min(inset + photo.height + 360, H - panel.y - insets.bottom - 24);
  const categoryLineHeight = 18 + 4;
  const name: Rect = {
    x: panel.x + pad,
    y: photo.y + photo.height + 16 + categoryLineHeight,
    width: panelW - pad * 2,
    height: 0,
  };
  const nameRatio = nameMetrics.fontSize / PANEL_NAME.fontSize;
  const photoRatio = src.photo.width / photo.width;
  const cardRatioX = src.card.width / panel.width;
  const cardRatioY = src.card.height / panel.height;
  const shadowRect: Rect = { x: panel.x + 20, y: panel.y + panel.height - 26, width: panel.width - 40, height: 60 };

  const rootStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  // "Window" depth once the panel has arrived: tilting the phone moves the
  // artwork against the hologram layer. Calibrated to the pose at arrival,
  // low-pass filtered and clamped; mounted only while a panel is open; off
  // with reduced motion. Text and controls never move with it. (Hands-free
  // mode will drive the same values from front-camera head tracking.)
  const sensor = useAnimatedSensor(SensorType.ROTATION, { interval: 33 });
  const baseline = useSharedValue<{ pitch: number; roll: number } | null>(null);
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);
  useAnimatedReaction(
    () => sensor.sensor.value,
    (v) => {
      if (!fx.parallax || progress.value < 0.98) {
        baseline.value = null;
        tiltX.value += (0 - tiltX.value) * 0.25;
        tiltY.value += (0 - tiltY.value) * 0.25;
        return;
      }
      if (!baseline.value) {
        baseline.value = { pitch: v.pitch, roll: v.roll };
        return;
      }
      const nx = Math.max(-1, Math.min(1, (v.roll - baseline.value.roll) / 0.35));
      const ny = Math.max(-1, Math.min(1, (v.pitch - baseline.value.pitch) / 0.35));
      tiltX.value += (nx - tiltX.value) * 0.2;
      tiltY.value += (ny - tiltY.value) * 0.2;
    },
  );

  const scrimStyle = useAnimatedStyle(() => ({ opacity: 0.6 * progress.value }));

  // Floating shadow under the panel: grows and drops as the panel lifts,
  // settles softer on arrival.
  const shadowStyle = useAnimatedStyle(() => {
    const t = reduce ? 1 : progress.value;
    const peak = fx.perspective ? flightPeak(progress.value) : 0;
    return {
      opacity: reduce ? 0 : 0.55 * t,
      transform: [{ translateY: 26 * peak }, { scaleX: 0.9 + 0.1 * t + 0.12 * peak }],
    };
  });

  const shellTravel = useAnimatedStyle(() => {
    const t = reduce ? 1 : progress.value;
    return {
      opacity: reduce ? progress.value : 1,
      transform: [
        { translateX: (src.card.x - panel.x) * (1 - t) },
        { translateY: (src.card.y - panel.y) * (1 - t) },
        { scaleX: cardRatioX + (1 - cardRatioX) * t },
        { scaleY: cardRatioY + (1 - cardRatioY) * t },
      ],
    };
  });

  // The detaching surface swings in 3D, flat again on arrival. Its corner
  // radius is fixed: animating borderRadius re-clipped the layer every frame
  // on Android's render thread (measured on a Pixel 4a).
  const shellInner = useAnimatedStyle(() => {
    const peak = fx.perspective ? flightPeak(progress.value) : 0;
    return {
      transform: [
        { perspective: 1100 },
        { rotateX: `${flight.shellRotateXDeg * peak}deg` },
        { rotateY: `${flight.shellRotateYDeg * peak}deg` },
      ],
    };
  });

  const heroTravel = useAnimatedStyle(() => {
    const t = reduce ? 1 : progress.value;
    return {
      opacity: reduce ? progress.value : 1,
      transform: [
        { translateX: (src.photo.x - photo.x) * (1 - t) },
        { translateY: (src.photo.y - photo.y) * (1 - t) },
        { scale: photoRatio + (1 - photoRatio) * t },
      ],
    };
  });

  // Frame breaking and selective distortion: the photo pitches, yaws, shears
  // and rises past the panel's top edge mid-flight, and is flat on arrival.
  const heroFlight = useAnimatedStyle(() => {
    const p = progress.value;
    const peak = fx.perspective ? flightPeak(p) : 0;
    const warp = fx.distortion ? flightPeak(p) : 0;
    const over = 1 + flight.artExtraScale * peak;
    return {
      transform: [
        { perspective: 900 },
        { translateY: -flight.artExtraLiftDp * 1.6 * peak },
        { rotateX: `${flight.artRotateXDeg * peak}deg` },
        { rotateY: `${flight.artRotateYDeg * peak + tiltX.value * 6}deg` },
        { rotateX: `${-tiltY.value * 6}deg` },
        { translateX: tiltX.value * 8 },
        { translateY: tiltY.value * 8 },
        { skewX: `${flight.artSkewXDeg * warp}deg` },
        { scaleX: over },
        { scaleY: over * (1 - flight.artSquash * warp) },
      ],
    };
  });

  // One light sweep across the photo while it is in the air.
  const heroSweep = useAnimatedStyle(() => {
    const p = progress.value;
    const peak = fx.highlight ? flightPeak(p) : 0;
    return {
      opacity: 0.28 * peak,
      transform: [{ translateX: -120 + p * (photo.width + 240) }, { rotate: '16deg' }],
    };
  });

  const srcNameTravel = useAnimatedStyle(() => {
    const t = reduce ? 1 : progress.value;
    return {
      opacity: reduce ? 0 : 1 - clamp01(t / 0.4),
      transform: [
        { translateX: (name.x - src.name.x) * t },
        { translateY: (name.y - src.name.y) * t },
        { scale: 1 + (1 / nameRatio - 1) * t },
      ],
    };
  });

  const dstNameTravel = useAnimatedStyle(() => {
    const t = reduce ? 1 : progress.value;
    return {
      opacity: reduce ? progress.value : clamp01((t - 0.25) / 0.4),
      transform: [
        { translateX: (src.name.x - name.x) * (1 - t) },
        { translateY: (src.name.y - name.y) * (1 - t) },
        { scale: nameRatio + (1 - nameRatio) * t },
      ],
    };
  });

  const srcNameFlight = useAnimatedStyle(() => {
    const peak = fx.textFlight ? flightPeak(progress.value) : 0;
    return {
      opacity: 1 - flight.textDim * peak,
      transform: [{ perspective: 700 }, { translateY: flight.textDriftDp * peak }, { rotateX: `${flight.textRotateXDeg * peak}deg` }],
    };
  });

  const dstNameFlight = useAnimatedStyle(() => {
    const peak = fx.textFlight ? flightPeak(progress.value) : 0;
    return {
      opacity: 1 - flight.textDim * peak,
      transform: [{ perspective: 700 }, { translateY: flight.textDriftDp * peak }, { rotateX: `${flight.textRotateXDeg * peak}deg` }],
    };
  });

  const detailReveal = useAnimatedStyle(() => {
    const r = reduce ? progress.value : clamp01((progress.value - 0.6) / 0.4);
    return { opacity: r, transform: [{ translateY: (1 - r) * 16 }] };
  });

  const closeReveal = useAnimatedStyle(() => {
    const r = reduce ? progress.value : clamp01((progress.value - 0.55) / 0.45);
    return { opacity: r };
  });

  const eyebrow = dish.eyebrow ?? (dish.category === 'Uncategorized' ? 'Place' : dish.category);
  const acceptsInput = phase !== 'closing';

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, rootStyle]}
      pointerEvents={acceptsInput ? 'box-none' : 'none'}
      accessibilityViewIsModal
      onAccessibilityEscape={close}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} importantForAccessibility="no" />
      </Animated.View>

      {/* Floating shadow */}
      <Animated.View pointerEvents="none" style={[styles.abs, rect(shadowRect), shadowStyle]}>
        <Image source={CONTACT_SHADOW} resizeMode="stretch" style={[styles.stretch, { tintColor: c.shadow }]} accessible={false} />
      </Animated.View>

      {/* Card surface */}
      <Animated.View pointerEvents="none" style={[styles.abs, styles.originTopLeft, rect(panel), shellTravel]}>
        <Animated.View style={[styles.fill, styles.shell, { backgroundColor: c.surface, borderColor: c.line }, shellInner]} />
      </Animated.View>

      {/* Readable detail content: fades in near arrival, static position. */}
      <Animated.View
        style={[styles.abs, styles.clipPanel, rect(panel), detailReveal]}
        pointerEvents={phase === 'open' ? 'box-none' : 'none'}
      >
        <View style={{ height: inset + photo.height + 16 }} />
        <View style={{ paddingHorizontal: pad }}>
          <Text style={[styles.category, { color: c.muted }]} numberOfLines={1}>
            {eyebrow}
          </Text>
          {/* Reserves the title's space; the visible title is the flying layer. */}
          <Text
            style={[styles.panelName, { opacity: 0 }]}
            numberOfLines={3}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {dish.name}
          </Text>
          <Text style={[styles.place, { color: c.muted }]}>{placeLine(dish)}</Text>
          {renderDetail ? (
            renderDetail(dish, close)
          ) : (
            <>
              <View style={styles.actions}>
                <View style={[styles.primary, { backgroundColor: c.accent }]} accessible accessibilityRole="button" accessibilityState={{ disabled: true }}>
                  <Text style={{ color: c.accentInk, fontFamily: fonts.bodyMedium, fontSize: 15 }}>I ate this — log it</Text>
                </View>
                <View
                  style={[styles.save, { borderColor: c.line }]}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="Save for later"
                  accessibilityState={{ disabled: true }}
                >
                  <Text style={{ color: c.ink, fontFamily: fonts.bodyMedium, fontSize: 15 }}>Save</Text>
                </View>
              </View>
              <Text style={[styles.note, { color: c.faint }]}>Not connected here: this is the MotionLab preview.</Text>
            </>
          )}
          {onDevRemoveSource && (
            <Pressable onPress={() => onDevRemoveSource(dish.id)} accessibilityRole="button" style={styles.devButton}>
              <Text style={[styles.devText, { color: c.rose }]}>Test: remove this card from the list</Text>
            </Pressable>
          )}
        </View>
      </Animated.View>

      {/* Card-sized name, fading out as it grows toward the title. */}
      <Animated.View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[styles.abs, styles.originTopLeft, { left: src.name.x, top: src.name.y, width: src.name.width }, srcNameTravel]}
      >
        <Animated.View style={srcNameFlight}>
          <Text style={[styles.dishFont, nameMetrics, { color: c.ink }]} numberOfLines={2}>
            {dish.name}
          </Text>
        </Animated.View>
      </Animated.View>

      {/* Panel title, growing in from the card and crisp on arrival. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.abs, styles.originTopLeft, { left: name.x, top: name.y, width: name.width }, dstNameTravel]}
      >
        <Animated.View style={dstNameFlight}>
          <Text style={[styles.panelName, { color: c.ink }]} numberOfLines={3} accessibilityRole="header">
            {dish.name}
          </Text>
        </Animated.View>
      </Animated.View>

      {/* Photo: a sibling above the surface, so it can break past the panel edge. */}
      <Animated.View pointerEvents="none" style={[styles.abs, styles.originTopLeft, rect(photo), heroTravel]}>
        <Animated.View style={[styles.fill, styles.clip, heroFlight]}>
          {dish.photo ? (
            <View style={styles.fill} renderToHardwareTextureAndroid>
              <Image source={dish.photo} resizeMode="cover" style={styles.fill} accessible={false} />
            </View>
          ) : (
            <CategoryArt category={dish.category} style={styles.fill} />
          )}
          {fx.highlight && <Animated.View style={[styles.sweep, heroSweep]} />}
        </Animated.View>
        {/* Hologram layer: rings, frame corners and one scan line in the brand's rose light. */}
        <HoloHud progress={progress} tiltX={tiltX} tiltY={tiltY} width={photo.width} height={photo.height} color={c.rose} enabled={!reduce} />
      </Animated.View>

      <Animated.View
        style={[styles.abs, { left: panel.x + panel.width - inset - 12 - 44, top: panel.y + inset + 12 }, closeReveal]}
        pointerEvents={acceptsInput ? 'auto' : 'none'}
      >
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={styles.closeButton}>
          <View style={[styles.closeBar, { transform: [{ rotate: '45deg' }] }]} />
          <View style={[styles.closeBar, { transform: [{ rotate: '-45deg' }] }]} />
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function rect(r: Rect) {
  return { left: r.x, top: r.y, width: r.width, height: r.height };
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  stretch: { width: '100%', height: '100%' },
  abs: { position: 'absolute', left: 0, top: 0 },
  originTopLeft: { transformOrigin: 'left top' },
  shell: { borderWidth: 1, borderRadius: PANEL_RADIUS },
  clip: { overflow: 'hidden', borderRadius: PANEL_PHOTO_RADIUS },
  clipPanel: { overflow: 'hidden', borderRadius: PANEL_RADIUS },
  sweep: { position: 'absolute', top: -60, bottom: -60, left: 0, width: 70, backgroundColor: '#FFFFFF' },
  dishFont: { fontFamily: fonts.dish },
  panelName: { fontFamily: fonts.dish, fontSize: PANEL_NAME.fontSize, lineHeight: PANEL_NAME.lineHeight },
  category: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, marginBottom: 4 },
  place: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 20, opacity: 0.55 },
  primary: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  save: { height: 48, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  note: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, marginTop: 10 },
  devButton: { minHeight: 44, justifyContent: 'center', marginTop: 6 },
  devText: { fontFamily: fonts.body, fontSize: 13, textDecorationLine: 'underline' },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,18,16,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  closeBar: { position: 'absolute', width: 16, height: 1.6, borderRadius: 1, backgroundColor: '#FFFFFF' },
});
