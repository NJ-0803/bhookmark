import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { themes, type ThemeColors, type ThemeName } from './brand';

// Evening (default), Daylight, or Match device — the same three choices and
// storage key as the web app's src/theme.ts.
export type ThemePref = ThemeName | 'system';

const KEY = 'bhookmark.theme';

type ThemeContextValue = {
  name: ThemeName;
  colors: ThemeColors;
  pref: ThemePref;
  setPref: (pref: ThemePref) => void;
  /** False until the saved preference has been read, so the first frame never shows the wrong theme. */
  ready: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>('evening');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (live && (v === 'evening' || v === 'daylight' || v === 'system')) setPrefState(v);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const name: ThemeName = pref === 'system' ? (system === 'light' ? 'daylight' : 'evening') : pref;
  const colors = themes[name];

  // Root view colour behind every screen (and the Android window background).
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    AsyncStorage.setItem(KEY, next).catch(() => {});
  }, []);

  const value = useMemo(() => ({ name, colors, pref, setPref, ready }), [name, colors, pref, setPref, ready]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
