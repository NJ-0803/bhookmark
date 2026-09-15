import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getDishScore, type DishScoreResponse, type RemoteLog } from '../api/client';
import { ratingVerdict, VERDICT_COPY } from '../rating';
import { useSaves } from '../saves/SavesProvider';
import { fonts, type ThemeColors } from '../theme/brand';
import { useTheme } from '../theme/ThemeProvider';
import type { OverlayDish } from './CardOverlay';

/** Under a dish's title (web DishPanel): the logging action and Save within
 * reach, then real ratings only when real logs exist. */
export function DishActions({ dish, onLog }: { dish: OverlayDish; onLog: () => void }) {
  const { colors: c } = useTheme();
  const { isSaved, toggle, error } = useSaves();
  const saved = isSaved(dish.name, dish.venue);
  const [score, setScore] = useState<DishScoreResponse | null>(null);

  useEffect(() => {
    let live = true;
    getDishScore(dish.venue, dish.category, dish.subtype, dish.name).then((res) => {
      if (live && res.ok && 'community' in res) setScore(res);
    });
    return () => {
      live = false;
    };
  }, [dish.venue, dish.category, dish.subtype, dish.name]);

  return (
    <View>
      <View style={styles.actions}>
        <Pressable onPress={onLog} accessibilityRole="button" style={[styles.primary, { backgroundColor: c.accent }]}>
          <Text style={[styles.primaryText, { color: c.accentInk }]}>I ate this — log it</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            toggle({ name: dish.name, venue: dish.venue, area: dish.area, category: dish.category, subtype: dish.subtype });
          }}
          accessibilityRole="button"
          accessibilityLabel={saved ? 'Saved for later. Tap to remove' : 'Save for later'}
          accessibilityState={{ selected: saved }}
          style={[styles.save, { borderColor: saved ? c.accent : c.line, backgroundColor: saved ? c.accentDim : 'transparent' }]}
        >
          <Text style={[styles.saveText, { color: saved ? c.rose : c.ink }]}>{saved ? 'Saved' : 'Save'}</Text>
        </Pressable>
      </View>
      {error && <Text style={[styles.small, { color: c.bad, marginTop: 8 }]}>{error}</Text>}

      {score && score.community.count > 0 && (
        <View style={[styles.box, { borderColor: c.line }]}>
          <Text style={[styles.boxTitle, { color: c.ink }]}>Ratings from real logs</Text>
          <ScoreRow c={c} label="Community" score={score.community.score} count={score.community.count} />
          <ScoreRow c={c} label="Verified only" score={score.verifiedOnly.score} count={score.verifiedOnly.count} />
          {score.yours && <ScoreRow c={c} label="Your rating" score={score.yours.score} count={1} highlight />}
        </View>
      )}
    </View>
  );
}

/** Under one of the user's own logs (web LogPanel): their number, what
 * Bhookmark thinks of it, the note, and status chips. */
export function LogDetail({ log }: { log: RemoteLog }) {
  const { colors: c } = useTheme();
  const verdict = VERDICT_COPY[log.verdict];
  return (
    <View style={styles.logBlock}>
      <View style={styles.scoreRow}>
        <Text style={[styles.bigScore, { color: c.ink }]}>{log.score.toFixed(1)}</Text>
        <Text style={[styles.small, { color: c.faint }]}>/ 10</Text>
        {log.verified && <Text style={[styles.verified, { color: c.rose }]}>VERIFIED</Text>}
      </View>
      <Text style={[styles.small, { color: c.muted, marginTop: 6 }]}>{ratingVerdict(log.score).line}</Text>
      {log.note ? <Text style={[styles.body, { color: c.ink }]}>“{log.note}”</Text> : null}
      <View style={styles.chips}>
        {log.verdict === 'loved' && <Chip c={c} label="Running it back" tone="accent" />}
        <Chip c={c} label={verdict.label} tone={verdict.tone} />
        {log.status === 'held' && <Chip c={c} label="Pending review" tone="neutral" />}
        {log.ownerDisclosed && <Chip c={c} label="Restaurant representative" tone="neutral" />}
        {log.visibility === 'private' && <Chip c={c} label="Private" tone="neutral" />}
      </View>
    </View>
  );
}

function ScoreRow({ c, label, score, count, highlight }: { c: ThemeColors; label: string; score: number | null; count: number; highlight?: boolean }) {
  return (
    <View style={styles.scoreLine}>
      <Text style={[styles.body14, { color: highlight ? c.rose : c.ink }]}>{label}</Text>
      <Text style={[styles.mono, { color: c.ink }]}>
        {score !== null ? score.toFixed(1) : '—'}
        <Text style={[styles.small, { color: c.muted }]}> {count === 1 ? '1 log' : `${count} logs`}</Text>
      </Text>
    </View>
  );
}

function Chip({ c, label, tone }: { c: ThemeColors; label: string; tone: 'accent' | 'neutral' | 'bad' }) {
  const bg = tone === 'accent' ? c.accentDim : tone === 'bad' ? c.badDim : c.surface2;
  const fg = tone === 'accent' ? c.rose : tone === 'bad' ? c.bad : c.muted;
  return <Text style={[styles.chip, { backgroundColor: bg, color: fg }]}>{label}</Text>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8, marginTop: 20 },
  primary: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: fonts.bodyMedium, fontSize: 15 },
  save: { height: 48, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.bodyMedium, fontSize: 15 },
  box: { borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 20 },
  boxTitle: { fontFamily: fonts.bodyMedium, fontSize: 14, marginBottom: 6 },
  scoreLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  logBlock: { marginTop: 20 },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  bigScore: { fontFamily: fonts.displayLight, fontSize: 44, lineHeight: 48, letterSpacing: -1.3 },
  verified: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, marginLeft: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  chip: { fontFamily: fonts.bodyMedium, fontSize: 11, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, marginTop: 12 },
  body14: { fontFamily: fonts.body, fontSize: 14 },
  mono: { fontFamily: fonts.mono, fontSize: 14 },
});
