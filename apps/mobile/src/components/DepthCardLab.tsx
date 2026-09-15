import { useEffect, useMemo, useState } from 'react';
import {
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
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { fonts, radius, themes, type ThemeName } from '../theme/brand';
import { effectsFor, flight, flightPeak, limits, timing, type QualityTier } from '../motion/policy';

// The brief's isolated optical depth starter (parts 1–3), adapted to the
// shared theme and motion policy, then pushed to the bolder in-flight
// direction (see policy.ts): pronounced perspective, artwork breaking beyond
// the frame, temporary text drift and selective distortion, all driven by
// flightPeak(progress) so they are zero at rest and continuous when a
// transition is reversed mid-flight. It only drives a local visual preview —
// no overlay lifecycle, route or API (that is brief Step 3).

const CONTACT_SHADOW = require('../../assets/motion/contact-shadow.png');

type Props = {
  image: ImageSourcePropType;
  name: string;
  theme?: ThemeName;
  cutout?: boolean;
  tier?: QualityTier;
  hapticsEnabled?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export default function DepthCardLab({
  image,
  name,
  theme = 'evening',
  cutout = false,
  tier = 'full',
  hapticsEnabled = true,
  onOpenChange,
}: Props) {
  const c = themes[theme];
  const fx = effectsFor(tier);
  const reduce = tier === 'reduced';
  const { width } = useWindowDimensions();
  const w = Math.min(width - 64, 340);
  const [open, setOpen] = useState(false);
  const [artWidth, setArtWidth] = useState(0);
  const progress = useSharedValue(0);
  const x = useSharedValue(0);
  const press = useSharedValue(1);
  const sweep = useSharedValue(0);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!open) return false;
      setOpen(false);
      onOpenChange?.(false);
      return true;
    });
    return () => sub.remove();
  }, [open, onOpenChange]);

  useEffect(() => {
    // Interruptible: always animate from wherever progress is now, and only
    // for the distance left, so reversing mid-flight answers immediately.
    cancelAnimation(progress);
    const target = open ? 1 : 0;
    const remaining = Math.abs(target - progress.value);
    const base = open ? timing.open : timing.close;
    progress.value = withTiming(target, {
      duration: reduce ? 0 : Math.max(120, base * remaining),
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
    x.value = withTiming(0, { duration: 120 });
    cancelAnimation(sweep);
    sweep.value = 0;
    if (open && fx.highlight) {
      sweep.value = withTiming(1, { duration: timing.sweep, reduceMotion: ReduceMotion.System });
    }
  }, [open, reduce, fx.highlight, progress, x, sweep]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    onOpenChange?.(next);
    if (next && hapticsEnabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(open && fx.parallax)
        .activeOffsetX([-limits.tapSlopDp, limits.tapSlopDp])
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          x.value = Math.max(-1, Math.min(1, e.translationX / 90));
        })
        .onFinalize(() => {
          x.value = withTiming(0, { duration: timing.parallaxReturn });
        }),
    [open, fx.parallax, x],
  );

  // Background plane recedes and tips away at the peak, settling to a flat
  // 0.97 scale on arrival.
  const recess = useAnimatedStyle(() => {
    const p = progress.value;
    const peak = reduce ? 0 : flightPeak(p);
    return {
      opacity: 1 - p * 0.16,
      transform: [
        { perspective: 1000 },
        { rotateX: `${flight.backgroundRotateXDeg * peak}deg` },
        { scale: reduce ? 1 : 1 - p * (1 - limits.backgroundScale) - flight.backgroundExtraRecede * peak },
      ],
    };
  });

  const float = useAnimatedStyle(() => ({
    transform: [
      { translateY: reduce ? 0 : -22 * progress.value },
      { scale: press.value * (reduce ? 1 : 1 + 0.04 * progress.value) },
    ],
  }));

  // Artwork: pitches back and yaws while rising well past the frame's top
  // edge, overshoots in scale, and shears/squashes mid-flight; at rest only
  // the resting lift and touch parallax remain.
  const art = useAnimatedStyle(() => {
    const p = progress.value;
    const peak = fx.perspective ? flightPeak(p) : 0;
    const warp = fx.distortion ? flightPeak(p) : 0;
    const lift = reduce ? 1 : 1 + 0.06 * p + flight.artExtraScale * peak;
    return {
      transform: [
        { perspective: 900 },
        { translateY: reduce ? 0 : -20 * p - flight.artExtraLiftDp * peak },
        { translateX: fx.parallax ? x.value * limits.parallaxDp : 0 },
        { rotateX: `${flight.artRotateXDeg * peak}deg` },
        { rotateY: `${(fx.perspective ? x.value * limits.maxTiltDeg : 0) + flight.artRotateYDeg * peak}deg` },
        { skewX: `${flight.artSkewXDeg * warp}deg` },
        { scaleX: lift },
        { scaleY: lift * (1 - flight.artSquash * warp) },
      ],
    };
  });

  // Dish name and caption drift down, tip and dim while the artwork flies,
  // then return to a crisp, upright, fully opaque rest.
  const textFlight = useAnimatedStyle(() => {
    const peak = fx.textFlight ? flightPeak(progress.value) : 0;
    return {
      opacity: 1 - flight.textDim * peak,
      transform: [
        { perspective: 700 },
        { translateY: flight.textDriftDp * peak },
        { rotateX: `${flight.textRotateXDeg * peak}deg` },
      ],
    };
  });

  // As the hero rises the near shadow spreads and softens; the far layer
  // appears once lifted. Both widen a little more at the peak.
  const shadow = useAnimatedStyle(() => {
    const p = progress.value;
    const peak = reduce ? 0 : flightPeak(p);
    return {
      opacity: 0.45 - p * 0.1 - peak * 0.12,
      transform: [{ scaleX: 1 + p * 0.08 + peak * 0.1 }],
    };
  });

  const farShadow = useAnimatedStyle(() => {
    const p = progress.value;
    const peak = reduce ? 0 : flightPeak(p);
    return {
      opacity: p * 0.3 + peak * 0.08,
      transform: [{ scaleX: 0.9 + p * 0.1 + peak * 0.08 }],
    };
  });

  const highlight = useAnimatedStyle(() => ({
    opacity: sweep.value > 0 && sweep.value < 1 ? 0.2 : 0,
    transform: [{ translateX: -60 + sweep.value * (artWidth + 120) }, { rotate: '14deg' }],
  }));

  return (
    <View style={[s.stage, { backgroundColor: c.bg }]}>
      <Animated.View
        pointerEvents="none"
        style={[s.recess, { borderColor: c.line, backgroundColor: c.surface2 }, recess]}
      />
      <Animated.View style={[{ width: w }, float]}>
        <View style={[s.card, { backgroundColor: c.surface, borderColor: c.line }]}>
          <GestureDetector gesture={pan}>
            <View style={s.artStage} accessible={false} importantForAccessibility="no-hide-descendants">
              {/* The inner window clips nothing but itself; the hero is its
                  sibling, so the artwork can cross the window's top edge. */}
              <View style={[s.window, { backgroundColor: c.surface2, borderColor: c.line }]} />
              {/* Prepared soft alpha shadow (no animated blur radius). The
                  wrapper owns position and size: an Image given only
                  left/right keeps its 512px intrinsic width on Android. */}
              {fx.shadowLayers >= 2 && (
                <Animated.View pointerEvents="none" style={[s.farShadow, farShadow]}>
                  <Image
                    source={CONTACT_SHADOW}
                    accessible={false}
                    resizeMode="stretch"
                    style={{ width: '100%', height: '100%', tintColor: c.shadow }}
                  />
                </Animated.View>
              )}
              {fx.shadowLayers >= 1 && (
                <Animated.View pointerEvents="none" style={[s.shadow, shadow]}>
                  <Image
                    source={CONTACT_SHADOW}
                    accessible={false}
                    resizeMode="stretch"
                    style={{ width: '100%', height: '100%', tintColor: c.shadow }}
                  />
                </Animated.View>
              )}
              <Animated.View
                pointerEvents="none"
                onLayout={(e) => setArtWidth(e.nativeEvent.layout.width)}
                style={[s.hero, { borderRadius: cutout ? 0 : radius.inner }, art]}
              >
                <Image
                  source={image}
                  accessible={false}
                  resizeMode={cutout ? 'contain' : 'cover'}
                  style={StyleSheet.absoluteFill}
                />
                {fx.highlight && <Animated.View style={[s.highlight, highlight]} />}
              </Animated.View>
            </View>
          </GestureDetector>
          <Animated.View style={textFlight}>
            <Text style={[s.name, { color: c.ink }]}>{name}</Text>
            <Text style={[s.caption, { color: c.muted }]}>
              {open ? (fx.parallax ? 'Drag the image gently sideways' : 'Reduced motion: depth effects are off') : 'Open to explore the depth'}
            </Text>
          </Animated.View>
          <Pressable
            onPress={toggle}
            onPressIn={() => {
              press.value = withTiming(limits.pressScale, { duration: timing.pressIn });
            }}
            onPressOut={() => {
              press.value = withTiming(1, { duration: 120 });
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={open ? 'Close preview' : `Open ${name} preview`}
            style={[s.button, { backgroundColor: c.accent }]}
          >
            <Text style={{ color: c.accentInk, fontFamily: fonts.bodyMedium, fontSize: 15 }}>
              {open ? 'Close preview' : 'Open preview'}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  stage: { minHeight: 540, alignItems: 'center', justifyContent: 'center', paddingVertical: 70 },
  recess: { position: 'absolute', top: 48, bottom: 48, left: 16, right: 16, borderWidth: 1, borderRadius: 28 },
  card: { borderWidth: 1, borderRadius: radius.card, padding: 20, overflow: 'visible' },
  artStage: { height: 196, overflow: 'visible' },
  window: {
    position: 'absolute', top: 24, left: 0, right: 0, bottom: 0,
    borderWidth: 1, borderRadius: radius.inner, overflow: 'hidden',
  },
  hero: { position: 'absolute', left: 8, right: 8, top: -8, height: 184, overflow: 'hidden' },
  highlight: { position: 'absolute', top: -40, bottom: -40, width: 36, backgroundColor: '#FFFFFF' },
  shadow: { position: 'absolute', left: 24, right: 24, bottom: -6, height: 32 },
  farShadow: { position: 'absolute', left: 8, right: 8, bottom: -18, height: 52 },
  name: { fontFamily: fonts.dish, fontSize: 28, lineHeight: 33, marginTop: 16 },
  caption: { fontFamily: fonts.body, fontSize: 13, marginTop: 8, marginBottom: 16 },
  button: { minHeight: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 12 },
});
