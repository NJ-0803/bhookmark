import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useHandSight, useHandsFree, type HandSight } from '../handsfree/HandsFreeProvider';
import { useSavesOptional } from '../saves/SavesProvider';

// The Hands-free assistant, as a bookmark ribbon (concept C, chosen by the
// user 2026-09-18). It only exists while Hands-free is on and a dish is open,
// and adds to the panel without changing it:
// - back layer: tucked behind the card, its tip peeking over the top edge;
//   rises when a hand is seen, lifts and sways with a light when Ready, and
//   slips away when the dish is saved;
// - front layer: once the dish is saved, a ribbon drops across the photo's
//   corner, in front of the card, like a bookmark in a book.
// Pre-rendered image (no SVG) moved by transforms only, per the Android
// render-thread rule. Reduced motion: the same positions, no springs or sway.

const RIBBON = require('../../assets/motion/ribbon.png');
// The image is 192×576 px at 3x: a 40×150 dp ribbon with a baked drop shadow,
// padded 12 dp on the sides and top and 30 dp below.
const IMG_W = 64;
const IMG_H = 192;
const PAD = 12;
const RIBBON_W = 40;
const RIBBON_H = 150;
/** Flipped, the ribbon's tail starts this far down the image (the baked shadow's bottom padding). */
const FLIP_TOP = IMG_H - PAD - RIBBON_H;
/**
 * Distance of the ribbon from the panel's left edge: the top-left corner is
 * clear of the Hands-free pill (top centre) and the close button (top right),
 * which hid it on the Pixel 4a.
 */
const FROM_LEFT = 28;
/** The saved ribbon is shorter (about 120 dp), so it marks the photo without covering it. */
const FRONT_SCALE = 0.8;

type Rect = { x: number; y: number; width: number; height: number };
type Mode = 'idle' | 'hand' | 'ready' | 'saved';

/** How far the back ribbon shows above the card's top edge, per mode (dp). */
const PEEK: Record<Mode, number> = { idle: 26, hand: 40, ready: 74, saved: 0 };

function modeOf(sight: HandSight, saved: boolean): Mode {
  if (saved) return 'saved';
  if (sight === 'none') return 'idle';
  if (sight === 'ready') return 'ready';
  return 'hand';
}

const spring = { damping: 13, stiffness: 150, mass: 0.9 };

export default function AssistantRibbon({
  layer,
  panel,
  photo,
  dish,
  tiltX,
  reduce,
}: {
  layer: 'back' | 'front';
  panel: Rect;
  photo: Rect;
  dish: { name: string; venue: string };
  tiltX: SharedValue<number>;
  reduce: boolean;
}) {
  const { status } = useHandsFree();
  const sight = useHandSight();
  const saves = useSavesOptional();
  const saved = saves?.isSaved(dish.name, dish.venue) ?? false;
  const mode = modeOf(sight, saved);
  const on = status === 'on';

  const peek = useSharedValue(0); // back layer: dp above the card's top edge
  const sway = useSharedValue(0); // degrees
  const light = useSharedValue(0); // 0…1
  const drop = useSharedValue(0); // front layer: 0 hidden … 1 resting on the photo

  useEffect(() => {
    const move = (v: SharedValue<number>, to: number) => {
      v.value = reduce ? to : withSpring(to, spring);
    };
    if (layer === 'back') {
      // Enters from hidden once the panel has arrived.
      move(peek, on ? PEEK[mode] : 0);
      light.value = reduce ? (mode === 'ready' ? 1 : 0.35) : withTiming(mode === 'ready' ? 1 : mode === 'saved' ? 0 : 0.35, { duration: 220 });
      cancelAnimation(sway);
      if (on && mode === 'ready' && !reduce) {
        sway.value = withSequence(
          withTiming(-2.5, { duration: 600, easing: Easing.inOut(Easing.sin) }),
          withRepeat(withTiming(2.5, { duration: 1200, easing: Easing.inOut(Easing.sin) }), -1, true),
        );
      } else {
        sway.value = reduce ? 0 : withTiming(0, { duration: 300 });
      }
    } else {
      const show = on && mode === 'saved';
      drop.value = reduce ? (show ? 1 : 0) : show ? withDelay(120, withSpring(1, spring)) : withTiming(0, { duration: 180 });
    }
  }, [layer, mode, on, reduce, peek, sway, light, drop]);

  const left = panel.x + FROM_LEFT;

  const backStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tiltX.value * 4 },
      { translateY: -peek.value },
      { rotate: `${sway.value}deg` },
    ],
  }));
  const lightStyle = useAnimatedStyle(() => ({ opacity: light.value }));
  const frontStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, drop.value * 1.5),
    transform: [{ translateX: tiltX.value * 12 }, { translateY: -54 * (1 - drop.value) }],
  }));

  if (!on) return null;

  if (layer === 'back') {
    // Flipped so its notched tail sticks up out of the card, like a bookmark
    // out of a book; the rest is hidden behind the card. Sways about the point
    // where it meets the card's edge when Ready.
    return (
      <Animated.View
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        renderToHardwareTextureAndroid
        style={[styles.abs, { left: left - PAD, top: panel.y - FLIP_TOP, width: IMG_W, height: IMG_H, transformOrigin: `50% ${FLIP_TOP + PEEK.ready}px` }, backStyle]}
      >
        <Image source={RIBBON} style={[styles.img, styles.flip]} accessible={false} />
        {/* The assistant's light, just below the notch: dim when idle, lit when Ready. */}
        <Animated.View style={[styles.light, { left: PAD + RIBBON_W / 2 - 3, top: FLIP_TOP + 30 }, lightStyle]}>
          <View style={styles.halo} />
          <View style={styles.dot} />
        </Animated.View>
      </Animated.View>
    );
  }

  // Saved: drapes over the top of the photo, in front of the card.
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      renderToHardwareTextureAndroid
      style={[styles.abs, { left: left - PAD, top: photo.y - 8 - PAD, width: IMG_W, height: IMG_H * FRONT_SCALE }, frontStyle]}
    >
      <Image source={RIBBON} resizeMode="stretch" style={[styles.img, { height: IMG_H * FRONT_SCALE }]} accessible={false} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  img: { width: IMG_W, height: IMG_H },
  flip: { transform: [{ rotate: '180deg' }] },
  light: { position: 'absolute', width: 6, height: 6 },
  halo: { position: 'absolute', left: -5, top: -5, width: 16, height: 16, borderRadius: 8, backgroundColor: 'rgba(216,156,164,0.35)' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F3EEE7' },
});
