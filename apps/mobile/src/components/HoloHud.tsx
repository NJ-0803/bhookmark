import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { flightPeak } from '../motion/policy';

// Jarvis-style hologram layer for the opening dish, in Bhookmark's own rose
// light rather than sci-fi blue (user decision, 2026-09-15). Rings and a scan
// line exist only in flight; faint frame corners remain on arrival so the
// reading surface stays clear. It sits on its own depth plane: tilting the
// phone moves it against the photo. Decorative only, never text.

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

  const c = 14; // corner arm length
  return (
    <View pointerEvents="none" style={styles.layer} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.abs, { left: (width - outer) / 2, top: (height - outer) / 2, width: outer, height: outer }, outerStyle]}>
        <Svg width={outer} height={outer}>
          <Circle cx={outer / 2} cy={outer / 2} r={outer / 2 - 2} stroke={color} strokeWidth={1} fill="none" strokeDasharray={`${outer * 0.9} ${outer * 3}`} strokeLinecap="round" />
          <Circle cx={outer / 2} cy={outer / 2} r={outer / 2 - 8} stroke={color} strokeWidth={0.8} fill="none" strokeDasharray="2 9" />
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.abs, { left: (width - ring) / 2, top: (height - ring) / 2, width: ring, height: ring }, ringStyle]}>
        <Svg width={ring} height={ring}>
          <Circle cx={ring / 2} cy={ring / 2} r={ring / 2 - 2} stroke={color} strokeWidth={1.4} fill="none" strokeDasharray="5 11" />
          <Circle cx={ring / 2} cy={ring / 2} r={ring / 2 - 12} stroke={color} strokeWidth={2} fill="none" strokeDasharray={`${ring * 0.6} ${ring * 2.4}`} strokeLinecap="round" />
        </Svg>
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, cornersStyle]}>
        <Svg width={width} height={height}>
          <Path
            d={`M2 ${c + 2}V2h${c} M${width - c - 2} 2h${c}v${c} M${width - 2} ${height - c - 2}v${c}h-${c} M${c + 2} ${height - 2}H2v-${c}`}
            stroke={color}
            strokeWidth={1.6}
            fill="none"
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.scan, { backgroundColor: color, shadowColor: color }, scanStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'visible' },
  abs: { position: 'absolute' },
  scan: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 1.5,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
});
