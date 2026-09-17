import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { createLog, type RemoteLog } from '../api/client';
import { useHandsFree, useHandsFreeGestures } from '../handsfree/HandsFreeProvider';
import CategoryArt from '../components/CategoryArt';
import type { OverlayDish } from '../components/CardOverlay';
import RatingPicker from '../components/RatingPicker';
import { LOG_CATEGORIES } from '../data/categories';
import { ratingVerdict } from '../rating';
import { fonts, radius, type ThemeColors } from '../theme/brand';
import { useTheme } from '../theme/ThemeProvider';

// BiteLog, ported from the web LogFlow: what did you eat → ready to log (note,
// privacy) → your rating → added. Manual entry only, by product decision.
// Not yet in the app: attaching a photo and the optional location check that
// lets the server mark a log location-consistent — both post as "declared"
// until they are added.

type Step = 'details' | 'confirm' | 'rate' | 'done';

const OTHER = 'Other';

export default function LogFlow({
  prefill: initialPrefill,
  onClose,
  onLogged,
}: {
  prefill?: OverlayDish;
  onClose: () => void;
  onLogged: (log: RemoteLog) => void;
}) {
  const { colors: c } = useTheme();
  const [prefill, setPrefill] = useState<OverlayDish | undefined>(initialPrefill);
  const [step, setStep] = useState<Step>(initialPrefill ? 'confirm' : 'details');
  const [category, setCategory] = useState(LOG_CATEGORIES[0].name);
  const [subtype, setSubtype] = useState(LOG_CATEGORIES[0].subtypes[0]);
  const [customCategory, setCustomCategory] = useState('');
  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [note, setNote] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RemoteLog | null>(null);
  const idempotencyKey = useRef(Crypto.randomUUID());
  // One visit can hold several dishes; the server counts them as one visit.
  const visitId = useRef(Crypto.randomUUID());
  const [visitDishes, setVisitDishes] = useState<{ name: string; score: number }[]>([]);
  const handsFree = useHandsFree();

  // Hands-free rating dial: point one finger and draw circles in the air.
  // Clockwise raises, anticlockwise lowers, half a point per quarter turn.
  useHandsFreeGestures(step === 'rate' && !saving, (event) => {
    if (event.type === 'dial') {
      setRating((r) => Math.min(10, Math.max(0, (r ?? 5) + event.steps * 0.5)));
      Haptics.selectionAsync().catch(() => {});
    }
    return true; // nothing behind the rating screen should react
  });

  const working = prefill ?? {
    id: 'new',
    category: category === OTHER ? customCategory.trim() || OTHER : category,
    subtype: category === OTHER ? subtype.trim() || 'General' : subtype,
    name: name.trim(),
    venue: venue.trim() || 'Unnamed venue',
    area: '',
    photo: null,
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  async function finish() {
    if (rating === null || saving) return;
    setSaving(true);
    setError(null);
    const { verdict } = ratingVerdict(rating);
    // The same idempotency key is reused on retry, so a flaky connection can
    // never create a duplicate log server-side.
    const res = await createLog(
      {
        category: working.category,
        subtype: working.subtype,
        name: working.name,
        venue: working.venue,
        verdict,
        score: rating,
        note,
        visibility: isPrivate ? 'private' : 'public',
        visitId: visitId.current,
        evidence: { livePhoto: false, receipt: false, location: null },
      },
      idempotencyKey.current,
    );
    setSaving(false);
    if (!res.ok || !('log' in res) || !res.log) {
      setError(res.error ?? "Couldn't save this log. Try again.");
      return;
    }
    setResult(res.log);
    setVisitDishes((prev) => [...prev, { name: working.name, score: rating }]);
    onLogged(res.log);
    setStep('done');
  }

  function startAnotherDish() {
    // Same place and privacy; everything about the dish resets.
    setVenue(working.venue);
    setPrefill(undefined);
    setName('');
    setNote('');
    setRating(null);
    setResult(null);
    setError(null);
    idempotencyKey.current = Crypto.randomUUID();
    setStep('details');
  }

  const categoryList = [...LOG_CATEGORIES.map((x) => x.name), OTHER];
  const subtypes = LOG_CATEGORIES.find((x) => x.name === category)?.subtypes ?? [];

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { borderBottomColor: c.line }]}>
        <Text style={[styles.eyebrow, { color: c.faint }]}>BITELOG</Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[styles.closeButton, { backgroundColor: c.surface, borderColor: c.line }]}
        >
          <Text style={{ color: c.muted, fontSize: 16 }}>✕</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 'details' && (
            <View style={styles.gap}>
              {visitDishes.length > 0 && (
                <Text style={[styles.visitLine, { color: c.rose }]}>
                  Dish {visitDishes.length + 1} at {venue}
                </Text>
              )}
              <Text style={[styles.h3, { color: c.ink }]}>What did you eat?</Text>

              <Field label="Category" c={c}>
                <ChipRow
                  c={c}
                  options={categoryList.map((x) => [x, x === OTHER ? 'Other — not listed' : x])}
                  value={category}
                  onChange={(v) => {
                    setCategory(v);
                    setSubtype(v === OTHER ? '' : (LOG_CATEGORIES.find((x) => x.name === v)?.subtypes[0] ?? ''));
                  }}
                />
              </Field>

              {category === OTHER ? (
                <>
                  <Field label="What kind of food is this?" c={c}>
                    <Input c={c} value={customCategory} onChangeText={setCustomCategory} placeholder="e.g. Ethiopian, Ramen, Shawarma" />
                  </Field>
                  <Field label="Subtype (optional)" c={c}>
                    <Input c={c} value={subtype} onChangeText={setSubtype} placeholder="e.g. Spicy, Veg" />
                  </Field>
                </>
              ) : (
                <Field label="Subtype" c={c}>
                  <ChipRow c={c} options={subtypes.map((s) => [s, s])} value={subtype} onChange={setSubtype} />
                </Field>
              )}

              <Field label="Dish name" c={c}>
                <Input c={c} value={name} onChangeText={setName} placeholder="e.g. Chicken Biryani" />
              </Field>
              <Field label="Venue" c={c}>
                <Input c={c} value={venue} onChangeText={setVenue} placeholder="e.g. Truffles, Koramangala" />
              </Field>
              <Primary c={c} label="Continue" disabled={!name.trim() || !venue.trim()} onPress={() => setStep('confirm')} />
            </View>
          )}

          {step === 'confirm' && (
            <View>
              <Text style={[styles.h3, { color: c.ink, marginBottom: 20 }]}>Ready to log</Text>
              <View style={[styles.summary, { backgroundColor: c.surface, borderColor: c.line }]}>
                <Thumb dish={working} size={56} />
                <View style={styles.flex}>
                  <Text style={[styles.summaryName, { color: c.ink }]} numberOfLines={1}>
                    {working.name}
                  </Text>
                  <Text style={[styles.small, { color: c.faint }]} numberOfLines={1}>
                    {working.venue}
                  </Text>
                </View>
                <Text style={[styles.badge, { backgroundColor: c.surface2, color: c.faint }]}>manual only</Text>
              </View>

              <Field label="Add a note (optional)" c={c}>
                <Input
                  c={c}
                  value={note}
                  onChangeText={(v) => setNote(v.slice(0, 300))}
                  placeholder="What stood out — texture, spice, value, anything worth remembering?"
                  multiline
                />
              </Field>

              <View style={[styles.toggleRow, { backgroundColor: c.surface, borderColor: c.line }]}>
                <View style={styles.flex}>
                  <Text style={[styles.toggleLabel, { color: c.ink }]}>Keep this private</Text>
                  <Text style={[styles.small, { color: c.faint }]}>
                    Never counts toward any public score or shows to anyone else — still saved to your own Bhookmarks
                  </Text>
                </View>
                <Switch value={isPrivate} onValueChange={setIsPrivate} trackColor={{ true: c.accent }} accessibilityLabel="Keep this private" />
              </View>

              <Primary c={c} label="Continue to rating" onPress={() => setStep('rate')} />
            </View>
          )}

          {step === 'rate' && (
            <View>
              <Text style={[styles.eyebrow, { color: c.faint, marginBottom: 4 }]}>YOUR RATING</Text>
              <Text style={[styles.h3, { color: c.ink }]}>How good was it, really?</Text>
              <Text style={[styles.small, { color: c.muted, marginBottom: 28 }]}>
                You set the number. Bhookmark only tells you what it thinks of it.
              </Text>
              <RatingPicker value={rating} onChange={setRating} />
              {handsFree.status === 'on' && (
                <Text style={[styles.small, styles.center, { color: c.rose, marginTop: 14 }]}>
                  Hands-free: point one finger and draw a circle — clockwise to raise, anticlockwise to lower.
                </Text>
              )}
              {error && <Text style={[styles.error, { color: c.bad }]}>{error}</Text>}
              <Primary c={c} label={saving ? 'Saving…' : 'Add to Bhookmarks'} disabled={rating === null || saving} onPress={finish} />
            </View>
          )}

          {step === 'done' && result && (
            <View>
              <Text style={[styles.check, { color: c.ink }]}>✓</Text>
              <Text style={[styles.h3, styles.center, { color: c.ink }]}>Added to your Bhookmarks</Text>
              <Text style={[styles.small, styles.center, { color: result.status === 'held' ? c.rose : c.muted, marginBottom: 20 }]}>
                {result.status === 'held'
                  ? 'Held for a quick review before it counts publicly — logging bursts on one venue trigger this automatically.'
                  : "You'll see this instantly when you're deciding whether to bhookmark it again."}
              </Text>

              <Text style={[styles.eyebrow, { color: c.faint, marginBottom: 8 }]}>TASTE RECEIPT</Text>
              <View style={[styles.receipt, { backgroundColor: c.surface, borderColor: c.line }]}>
                <Thumb dish={working} size={72} />
                <Text style={[styles.receiptName, { color: c.ink }]}>{working.name}</Text>
                <Text style={[styles.small, { color: c.faint }]}>{working.venue}</Text>
                <View style={styles.receiptScore}>
                  <View style={styles.receiptNumberRow}>
                    <Text style={[styles.receiptNumber, { color: c.ink }]}>{result.score.toFixed(1)}</Text>
                    <Text style={[styles.small, { color: c.faint }]}>/ 10</Text>
                  </View>
                  <Text style={[styles.small, { color: c.faint }]}>your rating</Text>
                </View>
                <Text style={[styles.small, { color: c.muted }]}>{ratingVerdict(result.score).line}</Text>
              </View>

              {visitDishes.length > 1 && (
                <View style={[styles.visit, { borderColor: c.line }]}>
                  <Text style={[styles.toggleLabel, { color: c.ink, marginBottom: 8 }]}>This visit · {working.venue}</Text>
                  {visitDishes.map((d, i) => (
                    <View key={i} style={styles.visitRow}>
                      <Text style={[styles.body, { color: c.ink }]} numberOfLines={1}>
                        {d.name}
                      </Text>
                      <Text style={[styles.mono, { color: c.muted }]}>{d.score.toFixed(1)}</Text>
                    </View>
                  ))}
                </View>
              )}

              <Pressable onPress={startAnotherDish} accessibilityRole="button" style={[styles.secondary, { borderColor: c.rose }]}>
                <Text style={[styles.secondaryText, { color: c.rose }]}>+ Add another dish from this visit</Text>
              </Pressable>
              <Primary c={c} label="Done" onPress={onClose} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Thumb({ dish, size }: { dish: { category: string; photo: OverlayDish['photo'] }; size: number }) {
  return dish.photo ? (
    <Image source={dish.photo} style={{ width: size, height: size, borderRadius: 12 }} accessible={false} />
  ) : (
    <CategoryArt category={dish.category} compact style={{ width: size, height: size, borderRadius: 12 }} />
  );
}

function Field({ label, c, children }: { label: string; c: ThemeColors; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: c.faint }]}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Input({
  c,
  multiline,
  ...props
}: { c: ThemeColors; value: string; onChangeText: (v: string) => void; placeholder: string; multiline?: boolean }) {
  return (
    <TextInput
      {...props}
      multiline={multiline}
      placeholderTextColor={c.faint}
      style={[
        styles.input,
        multiline && styles.multiline,
        { color: c.ink, backgroundColor: c.surface2, borderColor: c.line },
      ]}
    />
  );
}

function ChipRow({
  c,
  options,
  value,
  onChange,
}: {
  c: ThemeColors;
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.chips} accessibilityRole="radiogroup">
      {options.map(([v, label]) => {
        const selected = v === value;
        return (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.chip, { borderColor: selected ? c.accent : c.line, backgroundColor: selected ? c.accentDim : c.surface }]}
          >
            <Text style={[styles.chipText, { color: selected ? c.ink : c.muted }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Primary({ c, label, onPress, disabled }: { c: ThemeColors; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.primary, { backgroundColor: c.accent, opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={[styles.primaryText, { color: c.accentInk }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.4 },
  closeButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 48 },
  gap: { gap: 16 },
  visitLine: { fontFamily: fonts.body, fontSize: 13 },
  h3: { fontFamily: fonts.display, fontSize: 21, lineHeight: 27, marginBottom: 4 },
  center: { textAlign: 'center' },
  field: { gap: 6, marginBottom: 16 },
  fieldLabel: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontFamily: fonts.body, fontSize: 16 },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, justifyContent: 'center' },
  chipText: { fontFamily: fonts.body, fontSize: 14 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radius.card, padding: 14, marginBottom: 20 },
  summaryName: { fontFamily: fonts.bodySemibold, fontSize: 15 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  badge: { fontFamily: fonts.mono, fontSize: 11, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: 'hidden' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8 },
  toggleLabel: { fontFamily: fonts.bodyMedium, fontSize: 15 },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, marginTop: 16 },
  primary: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  primaryText: { fontFamily: fonts.bodySemibold, fontSize: 16 },
  secondary: { height: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  secondaryText: { fontFamily: fonts.bodyMedium, fontSize: 15 },
  check: { fontSize: 36, textAlign: 'center', marginBottom: 8 },
  receipt: { borderWidth: 1, borderRadius: radius.card, padding: 18, marginBottom: 16, gap: 4 },
  receiptName: { fontFamily: fonts.dish, fontSize: 19, lineHeight: 23, marginTop: 10 },
  receiptScore: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 12 },
  receiptNumberRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  receiptNumber: { fontFamily: fonts.displayLight, fontSize: 30, lineHeight: 38 },
  visit: { borderWidth: 1, borderRadius: radius.card, padding: 14, marginBottom: 16 },
  visitRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 3 },
  body: { fontFamily: fonts.body, fontSize: 14, flex: 1 },
  mono: { fontFamily: fonts.mono, fontSize: 14 },
});
