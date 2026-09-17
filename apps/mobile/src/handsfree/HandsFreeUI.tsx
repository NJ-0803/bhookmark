import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { fonts, radius, type ThemeColors } from '../theme/brand';
import { useTheme } from '../theme/ThemeProvider';
import { useHandsFree } from './HandsFreeProvider';

// Line drawings of the two hand shapes, in the brand's rose.
function TwoFingers({ color, size = 56 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M17 26V9a2.5 2.5 0 0 1 5 0v14" />
      <Path d="M22 23V7a2.5 2.5 0 0 1 5 0v16" />
      <Path d="M27 24v-3a2.5 2.5 0 0 1 5 0v4a2.5 2.5 0 0 1 5 0v6c0 7-4.5 12-11 12h-2c-5 0-8.5-3-10.5-7.5L10 30a2.5 2.5 0 0 1 4-3l3 3" />
      <Path d="M5 16h6M37 16h6M7 13l-3 3 3 3M41 13l3 3-3 3" />
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

const GESTURES = [
  {
    key: 'swipe',
    title: 'Two-finger air swipe',
    body: 'Hold up only your index and middle fingers and sweep sideways to move between dishes. Any other hand shape is ignored.',
    Art: TwoFingers,
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
  'Uses your front camera while Hands-free is on and the app is open. Everything is processed on your phone — no photos or video are saved or sent anywhere.';

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
  const insets = useSafeAreaInsets();
  if (status !== 'on' && status !== 'starting') return null;
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={[styles.pillWrap, { top: insets.top + 6 }]} pointerEvents="box-none">
      <Pressable
        onPress={() => setEnabled(false)}
        accessibilityRole="button"
        accessibilityLabel="Hands-free is on and using the camera. Tap to turn it off."
        style={[styles.pill, { backgroundColor: c.surface, borderColor: c.accent }]}
      >
        <View style={[styles.dot, { backgroundColor: status === 'on' ? c.rose : c.faint }]} />
        <Text style={[styles.pillText, { color: c.ink }]}>{status === 'on' ? 'Hands-free' : 'Starting…'}</Text>
        <Text style={[styles.pillOff, { color: c.faint }]}>Off</Text>
      </Pressable>
    </Animated.View>
  );
}

/** The settings section in You. */
export function HandsFreeSettings({ c }: { c: ThemeColors }) {
  const { available, enabled, status, error, setEnabled, showIntro } = useHandsFree();
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
              ? 'On — try a two-finger air swipe on an open dish.'
              : status === 'starting'
                ? 'Starting the camera…'
                : 'Two-finger air swipes, circle-to-rate, and head-tracked depth.'}
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
  pillText: { fontFamily: fonts.bodyMedium, fontSize: 13 },
  pillOff: { fontFamily: fonts.body, fontSize: 12, textDecorationLine: 'underline' },
  section: { borderWidth: 1, borderRadius: radius.card, padding: 16, marginBottom: 14, gap: 10 },
  sectionTitle: { fontFamily: fonts.displayMedium, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  guideLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  guideText: { fontFamily: fonts.bodyMedium, fontSize: 14, textDecorationLine: 'underline' },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
