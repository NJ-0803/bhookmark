import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { fonts, radius } from '../theme/brand';
import { useTheme } from '../theme/ThemeProvider';

// Food Circles, Craving Rooms and Lists exist on the web app. The native
// brief's Step 4 journey is sign in, discover, save, log and journal, so
// Circles is not ported yet — this says so rather than faking it.
export default function CirclesScreen() {
  const { colors: c } = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.eyebrow, { color: c.faint }]}>CIRCLES</Text>
      <Text style={[styles.title, { color: c.ink }]}>Eat with your people.</Text>
      <View style={[styles.box, { borderColor: c.line, backgroundColor: c.surface }]}>
        <Text style={[styles.body, { color: c.ink }]}>Food Circles, Craving Rooms and Lists are live on bhookmark.com.</Text>
        <Text style={[styles.small, { color: c.muted }]}>
          They come to the app after the core journey — discovering, saving and logging — is complete.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 140 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.5, marginBottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 25, lineHeight: 30, marginBottom: 20 },
  box: { borderWidth: 1, borderRadius: radius.card, padding: 18, gap: 8 },
  body: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 21 },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
});
