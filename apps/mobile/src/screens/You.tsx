import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { USING_LOCAL_API } from '../api/config';
import { useAuth } from '../auth/AuthProvider';
import { useMotion } from '../motion/MotionProvider';
import { fonts, radius, type ThemeColors } from '../theme/brand';
import { useTheme, type ThemePref } from '../theme/ThemeProvider';

// You: account, appearance and motion settings, and sign out. The web
// Profile's Flavor DNA, taste game, venue claims and sessions are not in the
// app yet.
export default function YouScreen({ onOpenLab }: { onOpenLab?: () => void }) {
  const { colors: c, pref, setPref } = useTheme();
  const motion = useMotion();
  const { session, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const who = session?.user.phone ?? session?.user.email ?? 'your account';

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.eyebrow, { color: c.faint }]}>YOU</Text>
      <Text style={[styles.title, { color: c.ink }]}>Your passport</Text>
      <Text style={[styles.small, { color: c.muted, marginBottom: 20 }]}>
        Signed in as {who}
        {USING_LOCAL_API ? ' · development API (test data)' : ''}
      </Text>

      <Section title="Appearance" c={c}>
        <View style={[styles.segmented, { backgroundColor: c.surface2, borderColor: c.line }]} accessibilityRole="radiogroup">
          {(
            [
              ['evening', 'Evening'],
              ['daylight', 'Daylight'],
              ['system', 'Match device'],
            ] as [ThemePref, string][]
          ).map(([v, label]) => {
            const selected = pref === v;
            return (
              <Pressable
                key={v}
                onPress={() => setPref(v)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[styles.segment, selected && { backgroundColor: c.accent }]}
              >
                <Text style={[styles.segmentText, { color: selected ? c.accentInk : c.muted }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title="Motion" c={c}>
        <Row label="Reduce effects" c={c}>
          <Switch value={motion.reduceEffects} onValueChange={motion.setReduceEffects} trackColor={{ true: c.accent }} />
        </Row>
        <Row label="Haptics" c={c}>
          <Switch value={motion.hapticsEnabled} onValueChange={motion.setHapticsEnabled} trackColor={{ true: c.accent }} />
        </Row>
        {motion.systemReduce && (
          <Text style={[styles.small, { color: c.muted }]}>Your device's Reduce Motion setting is on, so depth effects are off.</Text>
        )}
      </Section>

      {onOpenLab && (
        <Pressable onPress={onOpenLab} accessibilityRole="button" style={[styles.outline, { borderColor: c.line }]}>
          <Text style={[styles.outlineText, { color: c.ink }]}>Open MotionLab (development only)</Text>
        </Pressable>
      )}

      <Pressable
        onPress={async () => {
          setSigningOut(true);
          await signOut();
        }}
        disabled={signingOut}
        accessibilityRole="button"
        style={[styles.outline, { borderColor: c.bad, opacity: signingOut ? 0.6 : 1 }]}
      >
        <Text style={[styles.outlineText, { color: c.bad }]}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, c, children }: { title: string; c: ThemeColors; children: React.ReactNode }) {
  return (
    <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.line }]}>
      <Text style={[styles.sectionTitle, { color: c.ink }]}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, c, children }: { label: string; c: ThemeColors; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: c.ink }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 140 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.5, marginBottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 25, lineHeight: 30, marginBottom: 4 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  section: { borderWidth: 1, borderRadius: radius.card, padding: 16, marginBottom: 14, gap: 12 },
  sectionTitle: { fontFamily: fonts.displayMedium, fontSize: 16 },
  segmented: { flexDirection: 'row', borderWidth: 1, borderRadius: 14, padding: 3 },
  segment: { flex: 1, minHeight: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontFamily: fonts.bodyMedium, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  rowLabel: { fontFamily: fonts.body, fontSize: 15 },
  outline: { height: 50, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  outlineText: { fontFamily: fonts.bodyMedium, fontSize: 15 },
});
