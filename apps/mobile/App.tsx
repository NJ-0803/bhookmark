import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { MotionProvider } from './src/motion/MotionProvider';
import AppShell from './src/screens/AppShell';
import SignIn from './src/screens/SignIn';
import { themes } from './src/theme/brand';
import { fontAssets } from './src/theme/fonts';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';

export default function App() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  return (
    <GestureHandlerRootView style={styles.fill}>
      {/* Initial metrics avoid a first frame laid out with zero insets
          (content under the status bar until insets arrive). */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          <MotionProvider>
            <AuthProvider>
              {fontsLoaded || fontError ? <Root /> : <View style={[styles.fill, { backgroundColor: themes.evening.bg }]} />}
            </AuthProvider>
          </MotionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  const { colors, name, ready } = useTheme();
  const { status } = useAuth();
  if (!ready || status === 'loading') return <View style={[styles.fill, { backgroundColor: themes.evening.bg }]} />;

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <StatusBar style={name === 'evening' ? 'light' : 'dark'} />
      {status === 'signedIn' ? <AppShell /> : <SignIn />}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
