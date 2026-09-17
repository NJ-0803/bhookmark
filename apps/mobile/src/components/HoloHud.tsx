import { Image, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { flightPeak } from '../motion/policy';

// Jarvis-style hologram layer for the opening dish, in Bhookmark's own rose
// light rather than sci-fi blue (user decision, 2026-09-15). Rings and a scan
// line exist only in flight; faint frame corners remain on arrival so the
// reading surface stays clear. It sits on its own depth plane: tilting the
// phone moves it against the photo. Decorative only, never text.
//
// The rings are pre-rendered white PNGs (assets/hud) tinted at runtime and
// the corners are plain bordered views. The first version drew dashed SVG
// circles that Android re-tessellated every frame while they rotated and
// scaled; together with the SVG category art that saturated the render
// thread and caused input ANRs on a Pixel 4a. The scan line has no shadow
// for the same reason.

const RING_INNER = require('../../assets/hud/ring-inner.png');
const RING_OUTER = require('../../assets/hud/ring-outer.png');

const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};

export default function HoloHud({
  progress,
  tiltX,
  tiltY,
  width,
  height,
  color,
  enabled,
}: {
  progress: SharedValue<number>;
  tiltX: SharedValue<number>;
  tiltY: SharedValue<number>;
  width: number;
  height: number;
  color: string;
  enabled: boolean;
}) {
  const ring = Math.min(width, height) * 0.8;
  const outer = ring * 1.22;

  const ringStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const peak = flightPeak(p);
    return {
      opacity: 0.9 * peak,
      transform: [
        { translateX: -tiltX.value * 12 },
        { translateY: -tiltY.value * 12 },
        { rotate: `${-90 + 220 * p}deg` },
        { scale: 0.78 + 0.28 * peak },
      ],
    };
  });

  const outerStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const peak = flightPeak(p);
    return {
      opacity: 0.55 * peak,
      transform: [
        { translateX: -tiltX.value * 18 },
        { translateY: -tiltY.value * 18 },
        { rotate: `${40 - 150 * p}deg` },
        { scale: 0.9 + 0.3 * peak },
      ],
    };
  });

  const cornersStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: 0.22 + 0.68 * flightPeak(p),
      transform: [{ translateX: -tiltX.value * 7 }, { translateY: -tiltY.value * 7 }, { scale: 1.1 - 0.1 * p }],
    };
  });

  const scanStyle = useAnimatedStyle(() => {
    const s = clamp01((progress.value - 0.3) / 0.6);
    return {
      opacity: s > 0 && s < 1 ? 0.75 : 0,
      transform: [{ translateY: s * height }],
    };
  });

  if (!enabled) return null;

  const corner = { borderColor: color };
  return (
    <View pointerEvents="none" style={styles.layer} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View renderToHardwareTextureAndroid style={[styles.abs, { left: (width - outer) / 2, top: (height - outer) / 2, width: outer, height: outer }, outerStyle]}>
        <Image source={RING_OUTER} style={{ width: outer, height: outer, tintColor: color }} accessible={false} />
      </Animated.View>

      <Animated.View renderToHardwareTextureAndroid style={[styles.abs, { left: (width - ring) / 2, top: (height - ring) / 2, width: ring, height: ring }, ringStyle]}>
        <Image source={RING_INNER} style={{ width: ring, height: ring, tintColor: color }} accessible={false} />
      </Animated.View>

      <Animated.View renderToHardwareTextureAndroid style={[styles.corners, cornersStyle]}>
        <View style={[styles.corner, styles.topLeft, corner]} />
        <View style={[styles.corner, styles.topRight, corner]} />
        <View style={[styles.corner, styles.bottomRight, corner]} />
        <View style={[styles.corner, styles.bottomLeft, corner]} />
      </Animated.View>

      <Animated.View style={[styles.scan, { backgroundColor: color }, scanStyle]} />
    </View>
  );
}

const ARM = 14;
const LINE = 1.6;

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'visible' },
  abs: { position: 'absolute' },
  corners: { position: 'absolute', top: 2, right: 2, bottom: 2, left: 2 },
  corner: { position: 'absolute', width: ARM, height: ARM },
  topLeft: { top: 0, left: 0, borderTopWidth: LINE, borderLeftWidth: LINE, borderTopLeftRadius: 2 },
  topRight: { top: 0, right: 0, borderTopWidth: LINE, borderRightWidth: LINE, borderTopRightRadius: 2 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: LINE, borderRightWidth: LINE, borderBottomRightRadius: 2 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: LINE, borderLeftWidth: LINE, borderBottomLeftRadius: 2 },
  scan: { position: 'absolute', left: 0, right: 0, top: 0, height: 1.5 },
});
