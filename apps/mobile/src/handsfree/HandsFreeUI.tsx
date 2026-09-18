import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { fonts, radius, type ThemeColors } from '../theme/brand';
import { useTheme } from '../theme/ThemeProvider';
import { useHandSight, useHandsFree } from './HandsFreeProvider';

// Line drawings of the two hand shapes, in the brand's rose.
function OpenPalm({ color, size = 56 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M16 27V13a2.2 2.2 0 0 1 4.4 0v10" />
      <Path d="M20.4 23V10a2.2 2.2 0 0 1 4.4 0v13" />
      <Path d="M24.8 23V11.5a2.2 2.2 0 0 1 4.4 0V24" />
      <Path d="M29.2 24v-8a2.2 2.2 0 0 1 4.4 0v14c0 7-4.5 12-11 12h-1.5c-4.5 0-8-2.8-10-7l-3-6a2.2 2.2 0 0 1 3.8-2.2L16 30" />
      <Path d="M40 12v10M37 15l3-3 3 3M37 19l3 3 3-3" />
    </Svg>
  );
}

function PointCircle({ color, size = 56 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20 30V14a2.5 2.5 0 0 1 5 0v11" />
      <Path d="M25 25a2.5 2.5 0 0 1 5 0v2a2.5 2.5 0 0 1 5 0v6c0 6-4 10-10 10h-2c-4 0-7-2.5-9-6l-2-4a2.5 2.5 0 0 1 4-3l4 3" />
      <Path d="M31 9a9 9 0 1 0-4 10" strokeDasharray="2 3" />
      <Path d="M27 16l0 3 3 0" />
    </Svg>
  );
}

function Face({ color, size = 56 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round">
      <Circle cx="24" cy="22" r="10" />
      <Path d="M20 20h.01M28 20h.01M20.5 26c2 1.6 5 1.6 7 0" />
      <Path d="M8 38c4-3 8-4 16-4s12 1 16 4" />
      <Path d="M6 22H2M46 22h-4M5 18l-3 4 3 4M43 18l3 4-3 4" />
    </Svg>
  );
}

function FistOpen({ color, size = 56 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 22c0-3 2-5 5-5h10c3 0 5 2 5 5v6c0 6-4 10-10 10s-10-4-10-10z" />
      <Path d="M17 17v5M22 17v5M27 17v5" />
      <Path d="M40 8v14M36 12l4-4 4 4M36 18l4 4 4-4" />
    </Svg>
  );
}

function Pyramid({ color, size = 56 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M14 38c0-8 4-16 10-26 6 10 10 18 10 26" />
      <Path d="M19 38c0-7 2-14 5-26M29 38c0-7-2-14-5-26" />
      <Path d="M24 6V2M16 8l-2-3M32 8l2-3" />
    </Svg>
  );
}

function Snap({ color, size = 56 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M16 40c-4-4-5-10-3-16l4-8c1-2 4-2 5 0l1 6 6-10c1-2 4-1 4 1l-3 12 5-3c2-1 4 1 3 3l-6 9c-3 5-10 8-16 6z" />
      <Path d="M36 6l-2 4M42 12l-4 1M40 4l-3 5" />
    </Svg>
  );
}

const GESTURES = [
  {
    key: 'swipe',
    title: 'Air swipe',
    body: 'Hold your hand still, in any shape, about a forearm\'s length in front of the screen. When the top of the screen says "Ready", sweep up or down to scroll, or sideways to move between open dishes. The screen follows your hand; a half-finished sweep springs back. Right after a swipe, a quick flick swipes again.',
    Art: OpenPalm,
  },
  {
    key: 'grab',
    title: 'Close and open your hand',
    body: 'From "Ready", close your open hand into a fist and the list moves down with your fingers. Hold the fist still for a moment, then open it, and the list moves up.',
    Art: FistOpen,
  },
  {
    key: 'bloom',
    title: 'Bloom to open a dish',
    body: 'The dish in the middle of the screen is outlined while your hand is in view. Pinch all your fingertips together like a pyramid, hold, then open them to open that dish.',
    Art: Pyramid,
  },
  {
    key: 'snap',
    title: 'Snap to close',
    body: 'Press your thumb to your middle finger, then snap. Bhookmark closes after a moment — tap the screen to stay. Snaps are ignored while you are logging a bite.',
    Art: Snap,
  },
  {
    key: 'dial',
    title: 'Circle to rate',
    body: 'Point one finger and draw circles in the air — clockwise to raise your score, anticlockwise to lower it.',
    Art: PointCircle,
  },
  {
    key: 'window',
    title: 'Look around the dish',
    body: 'Move your head and an open dish shifts in depth, like looking through a window.',
    Art: Face,
  },
] as const;

const PRIVACY =
  'Uses your front camera while Hands-free is on and the app is open. Everything is processed on your phone — no photos or video are saved or sent anywhere. It learns how you swipe, close and open your hand, and snap, so misses become rarer; that learning also stays on this phone.';

/** One-time introduction after sign-in: Bhookmark's signature feature. */
export function HandsFreeIntro() {
  const { colors: c } = useTheme();
  const { available, introSeen, markIntroSeen, setEnabled, error, enabled } = useHandsFree();
  const [busy, setBusy] = useState(false);
  if (!available || introSeen !== false) return null;

  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}>
      <SafeAreaView style={styles.fill}>
        <ScrollView contentContainerStyle={styles.introContent}>
          <Text style={[styles.eyebrow, { color: c.rose }]}>NEW · HANDS-FREE</Text>
          <Text style={[styles.introTitle, { color: c.ink }]}>Browse and rate without touching your phone.</Text>
          <Text style={[styles.lead, { color: c.muted }]}>
            Greasy fingers? Bhookmark reads three simple moves in front of your camera.
          </Text>
          <View style={styles.gestureList}>
            {GESTURES.map(({ key, title, body, Art }) => (
              <View key={key} style={[styles.gesture, { backgroundColor: c.surface, borderColor: c.line }]}>
                <View style={[styles.art, { backgroundColor: c.accentDim }]}>
                  <Art color={c.rose} />
                </View>
                <View style={styles.flex}>
                  <Text style={[styles.gestureTitle, { color: c.ink }]}>{title}</Text>
                  <Text style={[styles.small, { color: c.muted }]}>{body}</Text>
                </View>
              </View>
            ))}
          </View>
          <Text style={[styles.small, { color: c.faint }]}>{PRIVACY}</Text>
          {error && <Text style={[styles.small, { color: c.bad, marginTop: 10 }]}>{error}</Text>}
          <Pressable
            disabled={busy}
            onPress={async () => {
              if (enabled) return markIntroSeen();
              setBusy(true);
              const on = await setEnabled(true);
              setBusy(false);
              if (on) markIntroSeen();
            }}
            accessibilityRole="button"
            style={[styles.primary, { backgroundColor: c.accent, opacity: busy ? 0.6 : 1 }]}
          >
            <Text style={[styles.primaryText, { color: c.accentInk }]}>{busy ? 'Starting…' : enabled ? 'Got it' : 'Turn on Hands-free'}</Text>
          </Pressable>
          <Pressable onPress={markIntroSeen} accessibilityRole="button" style={styles.link}>
            <Text style={[styles.linkText, { color: c.faint }]}>Not now — you can turn it on later in You</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Animated.View>
  );
}

/** Always-visible sign that the camera is in use, with a one-tap off switch. */
export function HandsFreePill() {
  const { colors: c } = useTheme();
  const { status, setEnabled } = useHandsFree();
  const handSight = useHandSight();
  const insets = useSafeAreaInsets();
  if (status !== 'on' && status !== 'starting') return null;
  // Live feedback: the camera only sees a hand held about a forearm's length in front of the screen.
  const label = status !== 'on' ? 'Starting…' : { none: 'Hands-free', hand: 'Hand seen', ready: 'Ready', point: 'Dial ready', fist: 'Open to go up', pyramid: 'Open to view dish', snap: 'Snap to close' }[handSight];
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={[styles.pillWrap, { top: insets.top + 6 }]} pointerEvents="box-none">
      <Pressable
        onPress={() => setEnabled(false)}
        accessibilityRole="button"
        accessibilityLabel="Hands-free is on and using the camera. Tap to turn it off."
        style={[styles.pill, { backgroundColor: c.surface, borderColor: c.accent }]}
      >
        <View style={[styles.dot, handSight !== 'none' && styles.dotLive, { backgroundColor: status === 'on' && handSight !== 'none' ? c.rose : c.faint }]} />
        <Text style={[styles.pillText, { color: c.ink }]}>{label}</Text>
        <Text style={[styles.pillOff, { color: c.faint }]}>Off</Text>
      </Pressable>
    </Animated.View>
  );
}

/** The settings section in You. */
export function HandsFreeSettings({ c }: { c: ThemeColors }) {
  const { available, enabled, status, error, setEnabled, showIntro, resetLearning } = useHandsFree();
  const [learningReset, setLearningReset] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!available) {
    return (
      <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.line }]}>
        <Text style={[styles.sectionTitle, { color: c.ink }]}>Hands-free</Text>
        <Text style={[styles.small, { color: c.muted }]}>Coming to this device soon.</Text>
      </View>
    );
  }
  return (
    <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.line }]}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={[styles.sectionTitle, { color: c.ink }]}>Hands-free</Text>
          <Text style={[styles.small, { color: c.muted }]}>
            {status === 'on'
              ? 'On — hold up an open hand and sweep up or down.'
              : status === 'starting'
                ? 'Starting the camera…'
                : 'Open-palm air swipes, circle-to-rate, and head-tracked depth.'}
          </Text>
        </View>
        <Switch
          value={enabled}
          disabled={busy}
          onValueChange={async (on) => {
            setBusy(true);
            await setEnabled(on);
            setBusy(false);
          }}
          trackColor={{ true: c.accent }}
          accessibilityLabel="Hands-free mode"
        />
      </View>
      {GESTURES.map(({ key, title, Art }) => (
        <View key={key} style={styles.miniRow}>
          <Art color={c.rose} size={28} />
          <Text style={[styles.small, { color: c.ink }]}>{title}</Text>
        </View>
      ))}
      <Text style={[styles.small, { color: c.faint }]}>{PRIVACY}</Text>
      {error && <Text style={[styles.small, { color: c.bad }]}>{error}</Text>}
      <Pressable onPress={showIntro} accessibilityRole="button" style={styles.guideLink}>
        <Text style={[styles.guideText, { color: c.rose }]}>How Hands-free works</Text>
      </Pressable>
      {/* Hands-free learns how you swipe, close/open and snap, on this phone only. */}
      <Pressable
        onPress={() => {
          resetLearning();
          setLearningReset(true);
        }}
        accessibilityRole="button"
        style={styles.guideLink}
      >
        <Text style={[styles.guideText, { color: c.muted }]}>{learningReset ? 'Gesture style forgotten' : 'Forget my gesture style'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  introContent: { paddingHorizontal: 20, paddingTop: 36, paddingBottom: 40 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.5, marginBottom: 10 },
  introTitle: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.5, marginBottom: 10 },
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, marginBottom: 22 },
  gestureList: { gap: 10, marginBottom: 18 },
  gesture: { flexDirection: 'row', gap: 14, alignItems: 'center', borderWidth: 1, borderRadius: radius.card, padding: 14 },
  art: { width: 72, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  gestureTitle: { fontFamily: fonts.bodyMedium, fontSize: 16, marginBottom: 4 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  primary: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  primaryText: { fontFamily: fonts.bodySemibold, fontSize: 16 },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  linkText: { fontFamily: fonts.body, fontSize: 13, textDecorationLine: 'underline' },
  pillWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, minHeight: 36 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotLive: { width: 10, height: 10, borderRadius: 5 },
  pillText: { fontFamily: fonts.bodyMedium, fontSize: 13 },
  pillOff: { fontFamily: fonts.body, fontSize: 12, textDecorationLine: 'underline' },
  section: { borderWidth: 1, borderRadius: radius.card, padding: 16, marginBottom: 14, gap: 10 },
  sectionTitle: { fontFamily: fonts.displayMedium, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  guideLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  guideText: { fontFamily: fonts.bodyMedium, fontSize: 14, textDecorationLine: 'underline' },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
