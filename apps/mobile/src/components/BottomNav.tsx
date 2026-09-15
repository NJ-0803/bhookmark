import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { useMotion } from '../motion/MotionProvider';
import { fonts } from '../theme/brand';
import { useTheme } from '../theme/ThemeProvider';

// Native port of the web BottomNav: Crave · Bhookmarks · (Log a bite) ·
// Circles · You, with the same icon paths.

export type Tab = 'crave' | 'bhookmarks' | 'circles' | 'you';

const TABS: { id: Tab; label: string }[] = [
  { id: 'crave', label: 'Crave' },
  { id: 'bhookmarks', label: 'Bhookmarks' },
  { id: 'circles', label: 'Circles' },
  { id: 'you', label: 'You' },
];

function TabIcon({ tab, color }: { tab: Tab; color: string }) {
  const props = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (tab === 'crave') {
    return (
      <Svg {...props}>
        <Circle cx="11" cy="11" r="6.5" />
        <Path d="M16 16l4 4" />
      </Svg>
    );
  }
  if (tab === 'bhookmarks') {
    return (
      <Svg {...props}>
        <Path d="M7 3.5h10a1 1 0 0 1 1 1V20l-6-3.6L6 20V4.5a1 1 0 0 1 1-1z" />
      </Svg>
    );
  }
  if (tab === 'circles') {
    return (
      <Svg {...props}>
        <Circle cx="9" cy="12" r="5" />
        <Circle cx="15" cy="12" r="5" />
      </Svg>
    );
  }
  return (
    <Svg {...props}>
      <Circle cx="12" cy="8.5" r="3.5" />
      <Path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" />
    </Svg>
  );
}

export default function BottomNav({ active, onChange, onBite }: { active: Tab; onChange: (t: Tab) => void; onBite: () => void }) {
  const { colors: c } = useTheme();
  const { hapticsEnabled } = useMotion();
  const insets = useSafeAreaInsets();

  const tap = (style: Haptics.ImpactFeedbackStyle) => {
    if (hapticsEnabled) Haptics.impactAsync(style).catch(() => {});
  };

  const item = (t: { id: Tab; label: string }) => {
    const isActive = active === t.id;
    return (
      <Pressable
        key={t.id}
        onPress={() => {
          tap(Haptics.ImpactFeedbackStyle.Light);
          onChange(t.id);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={t.label}
        style={[styles.item, isActive && { backgroundColor: c.surface2 }]}
      >
        <TabIcon tab={t.id} color={isActive ? c.rose : c.faint} />
        <Text style={[styles.label, { color: isActive ? c.ink : c.faint }]}>{t.label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.wrap, { backgroundColor: c.bg, paddingBottom: Math.max(insets.bottom, 12) }]} accessibilityRole="tablist">
      <View style={[styles.bar, { backgroundColor: c.bg, borderColor: c.line }]}>
        {TABS.slice(0, 2).map(item)}
        <Pressable
          onPress={() => {
            tap(Haptics.ImpactFeedbackStyle.Medium);
            onBite();
          }}
          accessibilityRole="button"
          accessibilityLabel="Log a bite"
          style={[styles.fab, { backgroundColor: c.accent, borderColor: c.accent }]}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={c.accentInk} strokeWidth={1.6} strokeLinecap="round">
            <Path d="M12 5v14M5 12h14" />
          </Svg>
        </Pressable>
        {TABS.slice(2).map(item)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 6 },
  bar: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderWidth: 1, borderRadius: 26, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 },
  item: { width: 64, alignItems: 'center', gap: 4, paddingVertical: 6, borderRadius: 16 },
  label: { fontFamily: fonts.body, fontSize: 10 },
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: -16 }],
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
});
