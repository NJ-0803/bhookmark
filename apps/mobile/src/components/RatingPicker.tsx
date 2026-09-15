import Slider from '@react-native-community/slider';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ratingVerdict } from '../rating';
import { fonts } from '../theme/brand';
import { useTheme } from '../theme/ThemeProvider';

// Native port of the web RatingPicker: the user sets a 0–10 number in half
// points; Bhookmark only comments on it and never changes it.
export default function RatingPicker({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const { colors: c } = useTheme();
  const snap = (v: number) => Math.min(10, Math.max(0, Math.round(v * 2) / 2));
  const nudge = (delta: number) => onChange(snap((value ?? 5) + delta));

  return (
    <View>
      <View style={styles.readout}>
        <Text style={[styles.number, { color: c.ink }]}>{value === null ? '—' : value.toFixed(1)}</Text>
        <Text style={[styles.outOf, { color: c.faint }]}>/ 10</Text>
      </View>
      <Text style={[styles.verdict, { color: c.muted }]}>
        {value === null ? 'Slide to set your score.' : ratingVerdict(value).line}
      </Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => nudge(-0.5)}
          accessibilityRole="button"
          accessibilityLabel="Lower by half a point"
          style={[styles.nudge, { borderColor: c.line }]}
        >
          <Text style={[styles.nudgeText, { color: c.muted }]}>−</Text>
        </Pressable>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={10}
          step={0.5}
          value={value ?? 5}
          // Touching the thumb at its starting spot still counts as a choice.
          onSlidingStart={(v) => onChange(snap(v))}
          onValueChange={(v) => onChange(snap(v))}
          tapToSeek
          minimumTrackTintColor={c.accent}
          maximumTrackTintColor={c.line}
          thumbTintColor={c.rose}
          accessibilityLabel="Your rating out of 10"
        />
        <Pressable
          onPress={() => nudge(0.5)}
          accessibilityRole="button"
          accessibilityLabel="Raise by half a point"
          style={[styles.nudge, { borderColor: c.line }]}
        >
          <Text style={[styles.nudgeText, { color: c.muted }]}>+</Text>
        </Pressable>
      </View>
      <View style={styles.scale}>
        {['0', '5', '10'].map((n) => (
          <Text key={n} style={[styles.scaleText, { color: c.faint }]}>
            {n}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6 },
  number: { fontFamily: fonts.displayLight, fontSize: 56, lineHeight: 60, letterSpacing: -2 },
  outOf: { fontFamily: fonts.body, fontSize: 14 },
  verdict: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, textAlign: 'center', minHeight: 36, marginTop: 12, marginBottom: 20, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nudge: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  nudgeText: { fontFamily: fonts.body, fontSize: 20 },
  slider: { flex: 1, height: 44 },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 56 },
  scaleText: { fontFamily: fonts.mono, fontSize: 10 },
});
