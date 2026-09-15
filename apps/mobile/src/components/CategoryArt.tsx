import { Image, StyleSheet, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

// Fine-line category illustrations: the fallback wherever a dish or venue has
// no real photo. Never a monogram and never another venue's photo.
//
// The artwork is the web app's CategoryArt paths, pre-rendered to white PNGs
// (assets/art/glyphs) and tinted at runtime. They used to be live SVG, but
// these illustrations sit inside layers that scale and tilt during card
// transitions, and Android re-drew every SVG path each frame on its render
// thread — the main cause of dropped frames and input ANRs measured on a
// Pixel 4a (2026-09-15). A bitmap under a transform is nearly free to draw.

const GLYPHS: Record<string, ImageSourcePropType> = {
  Coffee: require('../../assets/art/glyphs/coffee.png'),
  Pizza: require('../../assets/art/glyphs/pizza.png'),
  Burger: require('../../assets/art/glyphs/burger.png'),
  Biryani: require('../../assets/art/glyphs/biryani.png'),
  'Dosa & Idli': require('../../assets/art/glyphs/dosa-idli.png'),
  'Ice Cream': require('../../assets/art/glyphs/ice-cream.png'),
  Momos: require('../../assets/art/glyphs/momos.png'),
  'Bakery & Sweets': require('../../assets/art/glyphs/bakery-sweets.png'),
  'Bars & Pubs': require('../../assets/art/glyphs/bars-pubs.png'),
  Chinese: require('../../assets/art/glyphs/chinese.png'),
  'North Indian': require('../../assets/art/glyphs/north-indian.png'),
  'Rolls & Kebabs': require('../../assets/art/glyphs/rolls-kebabs.png'),
  'South Indian Meals & Tiffin': require('../../assets/art/glyphs/south-indian-meals-tiffin.png'),
  'Street Food & Chaat': require('../../assets/art/glyphs/street-food-chaat.png'),
};

const FALLBACK: ImageSourcePropType = require('../../assets/art/glyphs/fallback.png');
// The web's radial-gradient(120% 90% at 30% 15%, accent/0.16, transparent 60%), as white alpha.
const TINT: ImageSourcePropType = require('../../assets/art/tint.png');

const glyphFor = (category: string | null | undefined) => (category && GLYPHS[category]) || FALLBACK;

export function CategoryGlyph({
  category,
  size,
  color,
  opacity = 1,
}: {
  category: string | null | undefined;
  size: number;
  color: string;
  opacity?: number;
}) {
  return <Image source={glyphFor(category)} style={{ width: size, height: size, tintColor: color, opacity }} accessible={false} />;
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
    <View
      style={[styles.surface, { backgroundColor: c.surface2 }, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      // Static content: cache it as one GPU texture so moving it is cheap.
      renderToHardwareTextureAndroid
    >
      <Image source={TINT} resizeMode="stretch" style={[styles.tint, { tintColor: c.accent }]} accessible={false} />
      <View style={compact ? styles.glyphCompact : styles.glyph}>
        <Image
          source={glyphFor(category)}
          resizeMode="contain"
          style={[styles.glyphImage, { tintColor: c.rose, opacity: compact ? 0.8 : 0.7 }]}
          accessible={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tint: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  glyphCompact: { width: '58%', aspectRatio: 1 },
  glyph: { height: '42%', maxHeight: 160, aspectRatio: 1 },
  glyphImage: { width: '100%', height: '100%' },
});
