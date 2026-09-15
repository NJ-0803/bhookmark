import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { browseDishes, getVenueCategories, searchVenues, type BrowseDish, type VenueSearchResult } from '../api/client';
import { absoluteUrl } from '../api/config';
import { useCardOverlay, type OverlayDish } from '../components/CardOverlay';
import { CategoryGlyph } from '../components/CategoryArt';
import DishCard from '../components/DishCard';
import { fonts, radius } from '../theme/brand';
import { useTheme } from '../theme/ThemeProvider';

// Crave (web Home, discovery part): search a dish or place, or pick a craving
// and browse the real catalog. Recommendations, trending and Places near you
// are not in the app yet.

const photoSource = (path: string | null) => {
  const uri = absoluteUrl(path);
  return uri ? { uri } : null;
};

const browseToDish = (d: BrowseDish): OverlayDish => ({
  id: `browse-${d.id}`,
  name: d.name,
  venue: d.venue,
  area: d.area,
  category: d.category,
  subtype: d.subtype,
  photo: photoSource(d.photo),
});

// Same mapping as the web's venueToDishEntry.
const venueToDish = (v: VenueSearchResult): OverlayDish => ({
  id: `place-${v.id}`,
  name: v.dishName ?? v.name,
  venue: v.name,
  area: v.area,
  category: v.category ?? 'Uncategorized',
  subtype: v.subtype ?? 'General',
  photo: photoSource(v.photo),
});

export default function CraveScreen() {
  const { colors: c } = useTheme();
  const { activeId } = useCardOverlay();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [categories, setCategories] = useState<string[] | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [browse, setBrowse] = useState<OverlayDish[] | null>(null);
  const [search, setSearch] = useState<OverlayDish[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim();

  useEffect(() => {
    getVenueCategories().then((res) => {
      if (res.ok && 'categories' in res) setCategories(res.categories);
      else {
        setCategories([]);
        setError(res.error ?? "Couldn't load cravings.");
      }
    });
  }, []);

  useEffect(() => {
    if (!category) return;
    let live = true;
    setBrowse(null);
    browseDishes(category).then((res) => {
      if (!live) return;
      if (res.ok && 'results' in res) setBrowse(res.results.map(browseToDish));
      else {
        setBrowse([]);
        setError(res.error ?? "Couldn't load that craving.");
      }
    });
    return () => {
      live = false;
    };
  }, [category]);

  // Debounced name search, as on the web.
  useEffect(() => {
    if (q.length < 2) {
      setSearch(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      searchVenues(q).then((res) => {
        if (!live) return;
        if (res.ok && 'results' in res) setSearch(res.results.map(venueToDish));
        else {
          setSearch([]);
          setError(res.error ?? "Couldn't search right now.");
        }
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const mode: 'category' | 'search' | 'idle' = category ? 'category' : q ? 'search' : 'idle';
  const data = mode === 'category' ? (browse ?? []) : mode === 'search' ? (search ?? []) : [];
  const loading = (mode === 'category' && browse === null) || (mode === 'search' && (q.length < 2 || search === null));
  const tileWidth = (Math.min(width, 560) - 32 - 12) / 2;
  const matchingCategories = useMemo(
    () => (q && categories ? categories.filter((name) => name.toLowerCase().includes(q.toLowerCase())) : []),
    [q, categories],
  );

  const header = (
    <View>
      {mode === 'category' ? (
        <>
          <Pressable onPress={() => setCategory(null)} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            <Text style={[styles.backText, { color: c.ink }]}>‹  {category}</Text>
          </Pressable>
          <Text style={[styles.meta, { color: c.muted }]}>
            {browse === null
              ? 'Loading…'
              : `${browse.length} ${category!.toLowerCase()} spot${browse.length === 1 ? '' : 's'} in Bangalore`}
          </Text>
        </>
      ) : (
        <>
          <Text style={[styles.area, { color: c.muted }]}>Bangalore</Text>
          <Text style={[styles.title, { color: c.ink }]}>What are you Bhookmarking now?</Text>
          <View style={[styles.search, { backgroundColor: c.surface, borderColor: c.line }]}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={c.faint} strokeWidth={1.6} strokeLinecap="round">
              <Circle cx="11" cy="11" r="6.5" />
              <Path d="M16 16l4 4" />
            </Svg>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search a dish, craving or place"
              placeholderTextColor={c.faint}
              accessibilityLabel="Search a dish, craving or place"
              returnKeyType="search"
              autoCorrect={false}
              style={[styles.searchInput, { color: c.ink }]}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel="Cravings">
            {categories === null
              ? [0, 1, 2, 3].map((i) => <View key={i} style={[styles.chipSkeleton, { backgroundColor: c.surface2 }]} />)
              : categories.map((name) => (
                  <Pressable
                    key={name}
                    onPress={() => setCategory(name)}
                    accessibilityRole="button"
                    style={[styles.chip, { backgroundColor: c.surface, borderColor: c.line }]}
                  >
                    <View style={[styles.chipIcon, { backgroundColor: c.accentDim }]}>
                      <CategoryGlyph category={name} size={19} color={c.rose} />
                    </View>
                    <Text style={[styles.chipText, { color: c.ink }]}>{name}</Text>
                  </Pressable>
                ))}
          </ScrollView>
          {error && <Text style={[styles.error, { color: c.bad }]}>{error}</Text>}
          {mode === 'search' && matchingCategories.length > 0 && (
            <>
              <Text style={[styles.section, { color: c.ink }]}>Cravings matching “{q}”</Text>
              <View style={styles.wrapChips}>
                {matchingCategories.map((name) => (
                  <Pressable
                    key={name}
                    onPress={() => setCategory(name)}
                    accessibilityRole="button"
                    style={[styles.chip, { backgroundColor: c.surface, borderColor: c.line }]}
                  >
                    <CategoryGlyph category={name} size={18} color={c.rose} />
                    <Text style={[styles.chipText, { color: c.ink }]}>{name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {mode === 'search' && <Text style={[styles.section, { color: c.ink }]}>Places matching “{q}”</Text>}
          {mode === 'idle' && (
            <Text style={[styles.hint, { color: c.muted }]}>Pick a craving above, or search for a dish or place.</Text>
          )}
        </>
      )}
    </View>
  );

  const empty = loading ? (
    <View style={styles.grid}>
      {[0, 1].map((i) => (
        <View key={i} style={[styles.tileSkeleton, { width: tileWidth, backgroundColor: c.surface2 }]} />
      ))}
    </View>
  ) : mode === 'idle' ? null : (
    <View style={[styles.emptyBox, { borderColor: c.line }]}>
      <Text style={[styles.emptyTitle, { color: c.ink }]}>{mode === 'search' ? `Nothing matches “${q}” yet` : 'Nothing here yet'}</Text>
      <Text style={[styles.emptyBody, { color: c.muted }]}>
        {mode === 'search'
          ? "It might be a real place we don't have yet."
          : 'Be the first — tap the + below to log one.'}
      </Text>
    </View>
  );

  return (
    <FlatList
      data={data}
      keyExtractor={(d) => d.id}
      numColumns={2}
      columnWrapperStyle={styles.column}
      renderItem={({ item }) => <DishCard dish={item} style={{ width: tileWidth }} />}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      scrollEnabled={activeId === null}
      initialNumToRender={8}
      windowSize={7}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 140 },
  column: { gap: 12, marginBottom: 12 },
  area: { fontFamily: fonts.body, fontSize: 13, marginBottom: 6 },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 33, letterSpacing: -0.6, marginBottom: 18 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, height: 52, marginBottom: 14 },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 16, height: '100%' },
  chips: { gap: 8, paddingBottom: 4, marginBottom: 16 },
  wrapChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingLeft: 6, paddingRight: 16, borderRadius: 22, borderWidth: 1 },
  chipIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: fonts.body, fontSize: 14 },
  chipSkeleton: { width: 128, height: 44, borderRadius: 22 },
  section: { fontFamily: fonts.bodyMedium, fontSize: 16, marginTop: 8, marginBottom: 10 },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, marginTop: 4 },
  error: { fontFamily: fonts.body, fontSize: 14, marginBottom: 10 },
  back: { minHeight: 44, justifyContent: 'center', marginBottom: 4 },
  backText: { fontFamily: fonts.display, fontSize: 21 },
  meta: { fontFamily: fonts.body, fontSize: 14, marginBottom: 14 },
  grid: { flexDirection: 'row', gap: 12 },
  tileSkeleton: { height: 200, borderRadius: radius.card },
  emptyBox: { borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.card, paddingHorizontal: 24, paddingVertical: 36, alignItems: 'center' },
  emptyTitle: { fontFamily: fonts.bodyMedium, fontSize: 16, marginBottom: 6, textAlign: 'center' },
  emptyBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
