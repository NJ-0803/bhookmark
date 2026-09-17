import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RemoteLog, SavedDish } from '../api/client';
import { absoluteUrl } from '../api/config';
import { useCardOverlay, type OverlayDish } from '../components/CardOverlay';
import DishCard from '../components/DishCard';
import { timeAgo } from '../rating';
import { useSaves } from '../saves/SavesProvider';
import { fonts, radius } from '../theme/brand';
import { useTheme } from '../theme/ThemeProvider';

// Bhookmarks (web Bhookmarks screen): saved for later, then the journal of
// the user's own logs. Flavor DNA is not in the app yet.

const savedToDish = (s: SavedDish): OverlayDish => ({
  id: `saved-${s.name.trim().toLowerCase()}|${s.venue.trim().toLowerCase()}`,
  name: s.name,
  venue: s.venue,
  area: s.area,
  category: s.category,
  subtype: s.subtype || 'General',
  photo: null,
});

const logToDish = (log: RemoteLog): OverlayDish => {
  const uri = absoluteUrl(log.photoUrl ?? null);
  return {
    id: `log-${log.id}`,
    name: log.name,
    venue: log.venue,
    area: '',
    category: log.category,
    subtype: log.subtype,
    photo: uri ? { uri } : null,
    eyebrow: `${log.category} · ${timeAgo(log.createdAt)}`,
    log,
  };
};

export default function BhookmarksScreen({
  logs,
  logsError,
  refreshing,
  onRefresh,
  onLogFirst,
}: {
  logs: RemoteLog[] | null;
  logsError: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onLogFirst: () => void;
}) {
  const { colors: c } = useTheme();
  const { saves } = useSaves();
  const { activeId } = useCardOverlay();
  const visible = (logs ?? []).filter((l) => l.status !== 'removed');
  const loading = logs === null && !logsError;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      scrollEnabled={activeId === null}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.rose} colors={[c.accent]} />}
    >
      <Text style={[styles.eyebrow, { color: c.faint }]}>YOUR BHOOKMARKS</Text>
      <Text style={[styles.title, { color: c.ink }]}>Never forget a bite.</Text>

      {logsError && (
        <View style={[styles.errorBox, { backgroundColor: c.badDim, borderColor: c.bad }]}>
          <Text style={[styles.errorText, { color: c.bad }]}>{logsError}</Text>
        </View>
      )}

      {saves.length > 0 && (
        <View style={styles.saved}>
          <Text style={[styles.section, { color: c.ink }]}>
            Saved for later <Text style={{ color: c.muted, fontFamily: fonts.body }}>· {saves.length}</Text>
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={activeId === null} contentContainerStyle={styles.savedRow}>
            {saves.map((s, i) => {
              const dish = savedToDish(s);
              return <DishCard key={dish.id} dish={dish} group="saved" order={i} style={styles.savedCard} />;
            })}
          </ScrollView>
        </View>
      )}

      {loading ? (
        <View style={[styles.box, { borderColor: c.line }]}>
          <Text style={[styles.faint, { color: c.faint }]}>Loading your Bhookmarks…</Text>
        </View>
      ) : visible.length === 0 ? (
        <View style={[styles.box, styles.dashed, { borderColor: c.line }]}>
          <Text style={[styles.emptyTitle, { color: c.ink }]}>Your Bhookmarks are embarrassingly empty</Text>
          <Text style={[styles.emptyBody, { color: c.muted }]}>
            Log your first bite and this becomes the fastest way to remember whether something's worth bhookmarking again.
          </Text>
          <Pressable onPress={onLogFirst} accessibilityRole="button" style={[styles.primary, { backgroundColor: c.accent }]}>
            <Text style={[styles.primaryText, { color: c.accentInk }]}>Fix that — log your first dish</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {visible.map((log, i) => (
            <DishCard
              key={log.id}
              dish={logToDish(log)}
              group="journal"
              order={i}
              variant="row"
              subline={`${log.venue} · ${timeAgo(log.createdAt)}`}
              trailing={log.score.toFixed(1)}
              note={log.note}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 140 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.5, marginBottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 25, lineHeight: 30, marginBottom: 20 },
  errorBox: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
  errorText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  saved: { marginBottom: 24 },
  section: { fontFamily: fonts.bodyMedium, fontSize: 16, marginBottom: 10 },
  savedRow: { gap: 12, paddingRight: 16 },
  savedCard: { width: 176 },
  box: { borderWidth: 1, borderRadius: radius.card, paddingHorizontal: 24, paddingVertical: 36, alignItems: 'center' },
  dashed: { borderStyle: 'dashed' },
  faint: { fontFamily: fonts.body, fontSize: 14 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 18, lineHeight: 23, textAlign: 'center', marginBottom: 6 },
  emptyBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 22, maxWidth: 280 },
  primary: { borderRadius: 12, paddingHorizontal: 22, height: 48, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: fonts.bodySemibold, fontSize: 14 },
  list: { gap: 10 },
});
