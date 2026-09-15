import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CardOverlayLayer, CardOverlayProvider, OverlayStage, useCardOverlay } from '../components/CardOverlay';
import DepthCardLab from '../components/DepthCardLab';
import DishCard from '../components/DishCard';
import { LAB_DISHES } from '../data/labDishes';
import { useMotion } from '../motion/MotionProvider';
import { timing } from '../motion/policy';
import { useFrameProbe } from '../motion/useFrameProbe';
import { fonts, radius, themes, type ThemeColors } from '../theme/brand';
import { useTheme, type ThemePref } from '../theme/ThemeProvider';

// Development-only scene (App.tsx never mounts it outside __DEV__).
// Top: real dish cards that pop open into the root overlay (brief Step 3).
// Below: the isolated in-place depth card (Step 2), settings, the frame
// probe readout (a callback count, not presented-frame evidence), the type
// specimen and token swatches.

const PHOTOS = {
  dosa: { name: 'Benne Masala Dosa', source: require('../../assets/lab/benne-masala-dosa.jpg') },
  pizza: { name: 'Margherita Pizza', source: require('../../assets/lab/margherita-pizza.jpg') },
} as const;

type ProbeResult = { callbacks: number; avgHz: number; latePct: number; longestMs: number; hz: number };

export default function MotionLab({ fontError, onClose }: { fontError: Error | null; onClose?: () => void }) {
  const { colors: c } = useTheme();
  useEffect(() => {
    if (!onClose) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [hz, setHz] = useState<60 | 90 | 120>(120);
  const [probing, setProbing] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const probe = useFrameProbe(probing, hz);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  // One scripted transition: collect until the motion has settled, then read
  // the shared values once.
  const startProbe = useCallback(
    (durationMs: number) => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      probe.reset();
      setProbing(true);
      settleTimer.current = setTimeout(() => {
        setProbing(false);
        setResult({ ...probe.read(), hz });
      }, durationMs + 150);
    },
    [probe, hz],
  );

  const onOverlayTransition = useCallback((_to: 0 | 1, durationMs: number) => startProbe(durationMs), [startProbe]);
  const removeSource = useCallback((id: string) => setRemoved((r) => (r.includes(id) ? r : [...r, id])), []);

  return (
    <CardOverlayProvider onTransitionStart={onOverlayTransition} onDevRemoveSource={removeSource}>
      <View style={[s.fill, { backgroundColor: c.bg }]}>
        <OverlayStage>
          <LabContent
            onClose={onClose}
            fontError={fontError}
            removed={removed}
            onRestore={() => setRemoved([])}
            hz={hz}
            setHz={setHz}
            probing={probing}
            result={result}
            onDepthCardToggle={(open) => startProbe(open ? timing.open : timing.close)}
          />
        </OverlayStage>
        <CardOverlayLayer />
      </View>
    </CardOverlayProvider>
  );
}

function LabContent({
  onClose,
  fontError,
  removed,
  onRestore,
  hz,
  setHz,
  probing,
  result,
  onDepthCardToggle,
}: {
  onClose?: () => void;
  fontError: Error | null;
  removed: string[];
  onRestore: () => void;
  hz: 60 | 90 | 120;
  setHz: (hz: 60 | 90 | 120) => void;
  probing: boolean;
  result: ProbeResult | null;
  onDepthCardToggle: (open: boolean) => void;
}) {
  const { colors: c, name: themeName, pref, setPref } = useTheme();
  const motion = useMotion();
  const { activeId } = useCardOverlay();
  const { width } = useWindowDimensions();
  const [photo, setPhoto] = useState<keyof typeof PHOTOS>('dosa');
  const cardWidth = (Math.min(width, 520) - 32 - 12) / 2;
  const dishes = LAB_DISHES.filter((d) => !removed.includes(d.id));

  return (
    <SafeAreaView style={s.fill} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content} scrollEnabled={activeId === null}>
        <Text style={[s.eyebrow, { color: c.faint }]}>DEV ONLY</Text>
        <View style={s.titleRow}>
          <Text style={[s.title, { color: c.ink }]}>MotionLab</Text>
          {onClose && (
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close MotionLab"
              style={[s.closeLab, { backgroundColor: c.surface, borderColor: c.line }]}
            >
              <Text style={{ color: c.muted, fontSize: 16 }}>✕</Text>
            </Pressable>
          )}
        </View>
        <Text style={[s.lead, { color: c.muted }]}>Tap a dish card to open it.</Text>

        <View style={s.grid}>
          {dishes.map((dish) => (
            <DishCard key={dish.id} dish={dish} style={{ width: cardWidth }} />
          ))}
        </View>
        {removed.length > 0 && (
          <Pressable onPress={onRestore} accessibilityRole="button" style={s.restore}>
            <Text style={[s.restoreText, { color: c.rose }]}>Restore removed cards ({removed.length})</Text>
          </Pressable>
        )}

        <Section title="Motion" c={c}>
          <Row label="Reduce effects" c={c}>
            <Switch value={motion.reduceEffects} onValueChange={motion.setReduceEffects} trackColor={{ true: c.accent }} />
          </Row>
          <Row label="Haptics" c={c}>
            <Switch value={motion.hapticsEnabled} onValueChange={motion.setHapticsEnabled} trackColor={{ true: c.accent }} />
          </Row>
          <Row label="Slow motion ×5 (inspect only)" c={c}>
            <Switch
              value={motion.slowMotion > 1}
              onValueChange={(on) => motion.setSlowMotion(on ? 5 : 1)}
              trackColor={{ true: c.accent }}
            />
          </Row>
          <Text style={[s.meta, { color: c.muted }]}>
            OS Reduce Motion: {motion.systemReduce ? 'on' : 'off'} · active tier: {motion.tier}
          </Text>
          <Segmented
            c={c}
            value={motion.performanceTier}
            onChange={motion.setPerformanceTier}
            options={[
              ['full', 'Full'],
              ['standard', 'Standard'],
            ]}
          />
        </Section>

        <Section title="Theme" c={c}>
          <Segmented<ThemePref>
            c={c}
            value={pref}
            onChange={setPref}
            options={[
              ['evening', 'Evening'],
              ['daylight', 'Daylight'],
              ['system', 'Match device'],
            ]}
          />
        </Section>

        <Section title="Frame probe (diagnostic, not GPU proof)" c={c}>
          <Segmented
            c={c}
            value={hz}
            onChange={setHz}
            options={[
              [60, '60 Hz'],
              [90, '90 Hz'],
              [120, '120 Hz'],
            ]}
          />
          <Text style={[s.mono, { color: c.ink }]}>
            {probing
              ? 'Collecting…'
              : result
                ? `${result.callbacks} callbacks · ${result.avgHz.toFixed(1)} Hz avg · ${result.latePct.toFixed(1)}% late @${result.hz} · longest ${result.longestMs.toFixed(1)} ms`
                : 'Open or close a card to run one transition.'}
          </Text>
        </Section>

        <Section title="In-place depth card (Step 2)" c={c}>
          <Segmented
            c={c}
            value={photo}
            onChange={setPhoto}
            options={[
              ['dosa', 'Dosa photo'],
              ['pizza', 'Pizza photo'],
            ]}
          />
        </Section>
        <DepthCardLab
          key={photo}
          image={PHOTOS[photo].source}
          name={PHOTOS[photo].name}
          theme={themeName}
          tier={motion.tier}
          hapticsEnabled={motion.hapticsEnabled}
          onOpenChange={onDepthCardToggle}
        />

        <Section title="Type specimen" c={c}>
          <Text style={{ fontFamily: fonts.display, fontSize: 25, lineHeight: 30, color: c.ink }}>Crave · Inter Tight 600</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: c.muted }}>
            Inter 400 — What are you bhookmarking now?
          </Text>
          <Text style={{ fontFamily: fonts.dish, fontSize: 28, lineHeight: 32, color: c.ink }}>Iced Rasberry Latte</Text>
          <Text style={{ fontFamily: fonts.dishItalic, fontSize: 20, lineHeight: 24, color: c.rose }}>Instrument Serif italic</Text>
          <Text style={[s.mono, { color: c.faint }]}>IBM PLEX MONO · 8.5 · 1.2 KM</Text>
          {fontError && <Text style={[s.meta, { color: c.bad }]}>Font load failed: {fontError.message}</Text>}
        </Section>

        <Section title="Tokens" c={c}>
          <View style={s.swatches}>
            {(Object.keys(themes[themeName]) as (keyof ThemeColors)[]).map((k) => (
              <View key={k} style={s.swatch}>
                <View style={[s.chip, { backgroundColor: c[k], borderColor: c.line }]} />
                <Text style={[s.swatchLabel, { color: c.faint }]}>{k}</Text>
              </View>
            ))}
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, c, children }: { title: string; c: ThemeColors; children: React.ReactNode }) {
  return (
    <View style={[s.section, { backgroundColor: c.surface, borderColor: c.line }]}>
      <Text style={[s.sectionTitle, { color: c.ink }]}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, c, children }: { label: string; c: ThemeColors; children: React.ReactNode }) {
  return (
    <View style={s.row}>
      <Text style={{ fontFamily: fonts.body, fontSize: 15, color: c.ink }}>{label}</Text>
      {children}
    </View>
  );
}

function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  c,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
  c: ThemeColors;
}) {
  return (
    <View style={[s.segmented, { backgroundColor: c.surface2, borderColor: c.line }]} accessibilityRole="radiogroup">
      {options.map(([v, label]) => {
        const selected = v === value;
        return (
          <Pressable
            key={String(v)}
            onPress={() => onChange(v)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[s.segment, selected && { backgroundColor: c.accent }]}
          >
            <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 14, color: selected ? c.accentInk : c.muted }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 48 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.5, marginTop: 12 },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 35 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeLab: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, marginTop: 4, marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  restore: { minHeight: 44, justifyContent: 'center', marginTop: 4 },
  restoreText: { fontFamily: fonts.body, fontSize: 14, textDecorationLine: 'underline' },
  section: { borderWidth: 1, borderRadius: radius.card, padding: 16, marginTop: 16, gap: 12 },
  sectionTitle: { fontFamily: fonts.displayMedium, fontSize: 16 },
  meta: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  mono: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  segmented: { flexDirection: 'row', borderWidth: 1, borderRadius: 14, padding: 3 },
  segment: { flex: 1, minHeight: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 64, alignItems: 'center', gap: 4 },
  chip: { width: 40, height: 40, borderRadius: 10, borderWidth: 1 },
  swatchLabel: { fontFamily: fonts.mono, fontSize: 10 },
});
