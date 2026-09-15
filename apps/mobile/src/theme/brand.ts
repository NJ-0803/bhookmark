// Bhookmark brand tokens for native. Values are copied from the web app's
// src/index.css (the RGB channel variables per theme) and tailwind.config.js,
// checked against the checkout on 2026-09-15 — they match the native motion
// brief's table exactly. The web additionally defines bad/badDim/scrim, which
// are carried over here so error states keep the same colours.

export type ThemeName = 'evening' | 'daylight';

export type ThemeColors = {
  bg: string;
  surface: string;
  surface2: string;
  line: string;
  ink: string;
  muted: string;
  faint: string;
  accent: string;
  accentInk: string;
  accentDim: string;
  rose: string;
  bad: string;
  badDim: string;
  scrim: string;
  shadow: string;
};

export const themes = {
  evening: {
    bg: '#151412', surface: '#23211F', surface2: '#2D2A27',
    line: '#3A3531', ink: '#F3EEE7', muted: '#BDB3A9',
    faint: '#9D948B', accent: '#8E3340', rose: '#D89CA4',
    accentInk: '#F3EEE7', accentDim: '#341D21',
    bad: '#E58A92', badDim: '#321A1D', scrim: '#080706', shadow: '#000000',
  },
  daylight: {
    bg: '#F3EEE7', surface: '#FFFCF8', surface2: '#E9E1D7',
    line: '#DCD2C6', ink: '#231E1A', muted: '#5A5048',
    faint: '#645A51', accent: '#8E3340', rose: '#8E3340',
    accentInk: '#F3EEE7', accentDim: '#F2DEE0',
    bad: '#A12D38', badDim: '#F8E2E3', scrim: '#231E1A', shadow: '#3C281E',
  },
} as const satisfies Record<ThemeName, ThemeColors>;

// Font family keys registered with useFonts at the root (see fonts.ts). Each
// key is one real weight file: never pair these with fontWeight, which makes
// Android synthesise a fake bold. The web caps bold/extrabold/black at 600.
export const fonts = {
  display: 'InterTight600',
  displayMedium: 'InterTight500',
  displayLight: 'InterTight300',
  body: 'Inter400',
  bodyLight: 'Inter300',
  bodyMedium: 'Inter500',
  bodySemibold: 'Inter600',
  dish: 'InstrumentSerif400',
  dishItalic: 'InstrumentSerif400Italic',
  mono: 'IBMPlexMono400',
  monoMedium: 'IBMPlexMono500',
} as const;

// tailwind.config.js type scale (rem -> dp at 16) and card radius.
export const type = {
  lg: { fontSize: 16, lineHeight: 22.4 },
  xl: { fontSize: 18, lineHeight: 24 },
  '2xl': { fontSize: 21, lineHeight: 27.2 },
  '3xl': { fontSize: 25, lineHeight: 30.4 },
  '4xl': { fontSize: 30, lineHeight: 35.2 },
  '5xl': { fontSize: 38, lineHeight: 38 },
} as const;

export const radius = {
  card: 22,
  inner: 18,
} as const;
