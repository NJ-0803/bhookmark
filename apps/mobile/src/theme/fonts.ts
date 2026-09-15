import { fonts } from './brand';

// The exact weights the web app loads (Inter 300–600, Inter Tight 300–600,
// Instrument Serif regular/italic, IBM Plex Mono 400/500), bundled from the
// OFL-licensed @expo-google-fonts packages. Required by file path so only
// these files are bundled, not every weight each package's index pulls in.
export const fontAssets: Record<string, number> = {
  [fonts.bodyLight]: require('@expo-google-fonts/inter/300Light/Inter_300Light.ttf'),
  [fonts.body]: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
  [fonts.bodyMedium]: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
  [fonts.bodySemibold]: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
  [fonts.displayLight]: require('@expo-google-fonts/inter-tight/300Light/InterTight_300Light.ttf'),
  [fonts.displayMedium]: require('@expo-google-fonts/inter-tight/500Medium/InterTight_500Medium.ttf'),
  [fonts.display]: require('@expo-google-fonts/inter-tight/600SemiBold/InterTight_600SemiBold.ttf'),
  [fonts.dish]: require('@expo-google-fonts/instrument-serif/400Regular/InstrumentSerif_400Regular.ttf'),
  [fonts.dishItalic]: require('@expo-google-fonts/instrument-serif/400Regular_Italic/InstrumentSerif_400Regular_Italic.ttf'),
  [fonts.mono]: require('@expo-google-fonts/ibm-plex-mono/400Regular/IBMPlexMono_400Regular.ttf'),
  [fonts.monoMedium]: require('@expo-google-fonts/ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf'),
};
