import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

// Fine-line category illustrations, ported path-for-path from the web app's
// src/components/CategoryArt.tsx: the fallback wherever a dish or venue has
// no real photo. Never a monogram and never another venue's photo.

const GLYPHS: Record<string, ReactNode> = {
  Coffee: (
    <>
      <Path d="M12 20h20v9a9 9 0 0 1-9 9h-2a9 9 0 0 1-9-9z" />
      <Path d="M32 23h2.5a4 4 0 0 1 0 8H32" />
      <Path d="M18 9.5c-1.8 2.6 1.8 3.8 0 6.5M24 8.5c-1.8 2.6 1.8 3.8 0 6.5M30 9.5c-1.8 2.6 1.8 3.8 0 6.5" />
      <Path d="M8 42h30" />
    </>
  ),
  Pizza: (
    <>
      <Path d="M9 14.5c9.5-5 20.5-5 30 0L24 42z" />
      <Path d="M11.8 19.5c7.6-3.6 16.8-3.6 24.4 0" />
      <Circle cx="21" cy="25" r="1.8" />
      <Circle cx="27.5" cy="29" r="1.8" />
      <Circle cx="23" cy="34" r="1.5" />
    </>
  ),
  Burger: (
    <>
      <Path d="M10 23a14 11 0 0 1 28 0z" />
      <Path d="M9 28h30" />
      <Path d="M9 32.5c3-2 5 2 7.5 0s5 2 7.5 0 5 2 7.5 0 5 2 7.5 0" />
      <Path d="M11 37h26v1.5a3.5 3.5 0 0 1-3.5 3.5h-19A3.5 3.5 0 0 1 11 38.5z" />
      <Path d="M19 16.5h.01M25 15h.01M29 18h.01" />
    </>
  ),
  Biryani: (
    <>
      <Path d="M12.5 23h23l-1.8 12.5a6 6 0 0 1-6 5.1h-7.4a6 6 0 0 1-6-5.1z" />
      <Path d="M9 23h30" />
      <Path d="M15 23a9 7 0 0 1 18 0" />
      <Path d="M24 12.5V16" />
      <Path d="M8.5 27H12M36 27h3.5" />
    </>
  ),
  'Dosa & Idli': (
    <>
      <Ellipse cx="24" cy="35" rx="18" ry="5.5" />
      <Path d="M9 31.5 38 19l2.5 8.5L10 33.5" />
      <Path d="M16 29l1.5 3.5M24 25.5l1.5 4M31.5 22.5l1.5 4" />
    </>
  ),
  'Ice Cream': (
    <>
      <Path d="M16.5 23 24 42l7.5-19" />
      <Path d="M15 23a9 9 0 0 1 18 0z" />
      <Path d="M19 29.5l8-3M20.5 34l6-2.2" />
      <Path d="M24 14v-3" />
    </>
  ),
  Momos: (
    <>
      <Path d="M10 33c0-9.5 6.3-17 14-17s14 7.5 14 17z" />
      <Path d="M24 16v6M18.5 18l2 4.5M29.5 18l-2 4.5" />
      <Path d="M7 33h34" />
      <Path d="M12 38h24" />
    </>
  ),
  'Bakery & Sweets': (
    <>
      <Path d="M14 27h20l-2.8 14h-14.4z" />
      <Path d="M11.5 27a12.5 9.5 0 0 1 25 0z" />
      <Path d="M19.5 27l1 14M28.5 27l-1 14" />
      <Circle cx="24" cy="14.5" r="2.2" />
    </>
  ),
  'Bars & Pubs': (
    <>
      <Path d="M13 12h19l-2 26a4 4 0 0 1-4 3.7h-7a4 4 0 0 1-4-3.7z" />
      <Path d="M14 19h17" />
      <Path d="M31.5 21h3a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H31" />
      <Path d="M19 25v10M25 25v10" />
    </>
  ),
  Chinese: (
    <>
      <Path d="M8 26h32c0 8.5-7 14-16 14S8 34.5 8 26z" />
      <Path d="M13.5 26c2-3 4-3 6 0s4 3 6 0 4-3 6 0" />
      <Path d="M27 7l-7 17M36 9.5 25 24" />
    </>
  ),
  'North Indian': (
    <>
      <Path d="M10 25h28c0 8-6.3 13-14 13s-14-5-14-13z" />
      <Path d="M5.5 25H10M38 25h4.5" />
      <Path d="M19 18.5c-1.6-2.2 1.6-3.3 0-5.5M24 17.5c-1.6-2.2 1.6-3.3 0-5.5M29 18.5c-1.6-2.2 1.6-3.3 0-5.5" />
      <Path d="M17 43h14" />
    </>
  ),
  'Rolls & Kebabs': (
    <>
      <Path d="M8 40 40 8" />
      <Rect x="13.5" y="25.5" width="9" height="9" rx="3" transform="rotate(-45 18 30)" />
      <Rect x="19.5" y="19.5" width="9" height="9" rx="3" transform="rotate(-45 24 24)" />
      <Rect x="25.5" y="13.5" width="9" height="9" rx="3" transform="rotate(-45 30 18)" />
    </>
  ),
  'South Indian Meals & Tiffin': (
    <>
      <Path d="M6 32c7-14.5 23-21 36-18.5-4.5 13-19.5 22-36 18.5z" />
      <Path d="M8.5 31 39.5 15" />
      <Circle cx="19" cy="29" r="3" />
      <Circle cx="28" cy="23.5" r="3" />
    </>
  ),
  'Street Food & Chaat': (
    <>
      <Path d="M8 28h32c-1.8 8-8 12.5-16 12.5S9.8 36 8 28z" />
      <Circle cx="17" cy="23" r="4.8" />
      <Circle cx="26.5" cy="21" r="5" />
      <Circle cx="34" cy="24.2" r="3.6" />
    </>
  ),
};

const FALLBACK = (
  <>
    <Path d="M16 8v11a4 4 0 0 0 8 0V8M20 8v34" />
    <Path d="M32 8c-3.5 3.5-3.5 13 0 16.5V42" />
  </>
);

export function CategoryGlyph({
  category,
  size,
  color,
  opacity = 1,
}: {
  category: string | null | undefined;
  size: number | `${number}%`;
  color: string;
  opacity?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke={color}
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
      accessible={false}
    >
      {(category && GLYPHS[category]) || FALLBACK}
    </Svg>
  );
}

/** A photo stand-in: the category line drawing on a quiet warm surface. */
export default function CategoryArt({
  category,
  compact = false,
  style,
}: {
  category: string | null | undefined;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={[styles.surface, { backgroundColor: c.surface2 }, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="tint" cx="30%" cy="15%" rx="120%" ry="90%" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={c.accent} stopOpacity={0.16} />
            <Stop offset="0.6" stopColor={c.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tint)" />
      </Svg>
      <View style={compact ? styles.glyphCompact : styles.glyph}>
        <CategoryGlyph category={category} size="100%" color={c.rose} opacity={compact ? 0.8 : 0.7} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  glyphCompact: { width: '58%', aspectRatio: 1 },
  glyph: { height: '42%', maxHeight: 160, aspectRatio: 1 },
});
