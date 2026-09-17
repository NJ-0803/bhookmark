import { useEffect, useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedRef, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { placeLine } from '../format';
import { limits, timing } from '../motion/policy';
import { fonts, radius } from '../theme/brand';
import { useTheme } from '../theme/ThemeProvider';
import { CARD_NAME, CARD_PHOTO_RADIUS, useCardOverlay, type NameMetrics, type OverlayDish } from './CardOverlay';
import CategoryArt from './CategoryArt';

const ROW_NAME: NameMetrics = { fontSize: 19, lineHeight: 23 };

/** A tappable dish card that detaches into the root overlay. It stays mounted
 * (only made invisible) while its panel is open, so the list keeps its layout
 * and the overlay has a real place to return to.
 * - tile: photo on top, name and place below (browse grids, saved strip)
 * - row: square thumbnail, name with a trailing value, subline and note (journal) */
export default function DishCard({
  dish,
  variant = 'tile',
  style,
  subline,
  trailing,
  note,
  group,
  order,
}: {
  dish: OverlayDish;
  /** List name and position, so Hands-free swipes can move to the neighbouring dish. */
  group?: string;
  order?: number;
  variant?: 'tile' | 'row';
  style?: StyleProp<ViewStyle>;
  subline?: string;
  trailing?: string;
  note?: string;
}) {
  const { register, open, activeId, reduce } = useCardOverlay();
  const { colors: c } = useTheme();
  const card = useAnimatedRef<Animated.View>();
  const photo = useAnimatedRef<Animated.View>();
  const name = useAnimatedRef<Animated.View>();
  const focus = useRef<View>(null);
  const press = useSharedValue(1);
  const nameMetrics = variant === 'row' ? ROW_NAME : CARD_NAME;

  useEffect(
    () => register(dish.id, { card, photo, name, focus, nameMetrics, photoRadius: CARD_PHOTO_RADIUS, dish, group, order }),
    [register, dish, card, photo, name, nameMetrics, group, order],
  );

  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const hidden = activeId === dish.id;
  const place = subline ?? placeLine(dish);

  const media = dish.photo ? (
    <Image source={dish.photo} resizeMode="cover" style={styles.image} accessible={false} />
  ) : (
    <CategoryArt category={dish.category} compact={variant === 'row'} style={styles.image} />
  );

  return (
    <Animated.View
      ref={card}
      style={[styles.card, { backgroundColor: c.surface, borderColor: c.line, opacity: hidden ? 0 : 1 }, pressStyle, style]}
    >
      <Pressable
        ref={focus}
        onPress={() => open(dish)}
        onPressIn={() => {
          if (!reduce) press.value = withTiming(limits.pressScale, { duration: timing.pressIn });
        }}
        onPressOut={() => {
          press.value = withTiming(1, { duration: 120 });
        }}
        accessibilityRole="button"
        accessibilityLabel={`${dish.name}, ${place}${trailing ? `, ${trailing} out of 10` : ''}`}
        accessibilityHint="Opens the details"
        style={variant === 'row' ? styles.row : undefined}
      >
        {variant === 'row' ? (
          <>
            <Animated.View ref={photo} style={styles.thumb}>
              {media}
            </Animated.View>
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Animated.View ref={name} style={styles.rowNameWrap}>
                  <Text style={[styles.dishFont, ROW_NAME, { color: c.ink }]} numberOfLines={2}>
                    {dish.name}
                  </Text>
                </Animated.View>
                {trailing && <Text style={[styles.trailing, { color: c.ink }]}>{trailing}</Text>}
              </View>
              <Text style={[styles.place, { color: c.muted }]} numberOfLines={1}>
                {place}
              </Text>
              {note ? (
                <Text style={[styles.note, { color: c.ink }]} numberOfLines={2}>
                  “{note}”
                </Text>
              ) : null}
            </View>
          </>
        ) : (
          <>
            <Animated.View ref={photo} style={styles.photo}>
              {media}
            </Animated.View>
            <Animated.View ref={name} style={styles.nameWrap}>
              <Text style={[styles.dishFont, CARD_NAME, { color: c.ink }]} numberOfLines={2}>
                {dish.name}
              </Text>
            </Animated.View>
            <Text style={[styles.place, styles.tilePlace, { color: c.muted }]} numberOfLines={1}>
              {place}
            </Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  photo: { margin: 8, aspectRatio: 4 / 3, borderRadius: CARD_PHOTO_RADIUS, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  nameWrap: { marginHorizontal: 12, marginTop: 2 },
  dishFont: { fontFamily: fonts.dish },
  place: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, marginTop: 4 },
  tilePlace: { marginHorizontal: 12, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 12, padding: 12 },
  thumb: { width: 80, height: 80, borderRadius: CARD_PHOTO_RADIUS, overflow: 'hidden' },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowNameWrap: { flex: 1, minWidth: 0 },
  trailing: { fontFamily: fonts.mono, fontSize: 13, marginTop: 2 },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, marginTop: 4, opacity: 0.75 },
});
