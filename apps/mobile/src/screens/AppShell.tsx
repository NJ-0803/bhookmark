import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInLeft, FadeInRight, FadeOut, SlideInDown, SlideOutDown, useAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMyLogs, type RemoteLog } from '../api/client';
import BottomNav, { type Tab } from '../components/BottomNav';
import { CardOverlayLayer, CardOverlayProvider, OverlayStage, useCardOverlay, type OverlayDish } from '../components/CardOverlay';
import { DishActions, LogDetail } from '../components/DishDetail';
import { timing } from '../motion/policy';
import { fonts } from '../theme/brand';
import { SavesProvider } from '../saves/SavesProvider';
import { useHandsFree, useHandsFreeGestures } from '../handsfree/HandsFreeProvider';
import { HandsFreeIntro, HandsFreePill } from '../handsfree/HandsFreeUI';
import { useTheme } from '../theme/ThemeProvider';
import BhookmarksScreen from './Bhookmarks';
import CirclesScreen from './Circles';
import CraveScreen from './Crave';
import LogFlow from './LogFlow';
import MotionLab from './MotionLab';
import YouScreen from './You';

// The signed-in app (brief Step 4): tabs with the web's structure, one shared
// card overlay for every screen, and BiteLog as a sheet above everything.
export default function AppShell() {
  const { colors: c } = useTheme();
  const { status: handsFreeStatus, interrupt, cancelSnap } = useHandsFree();
  const handsFreeOn = handsFreeStatus === 'on';
  // Hands-free Thanos snap closes the app, after a short, cancellable notice so
  // an accidental snap can be undone with a touch. Never while a bite is being
  // logged, so unsaved input can't be lost.
  const [closing, setClosing] = useState(false);
  const logFlowOpen = useRef(false);
  useHandsFreeGestures(true, (event) => {
    if (event.type !== 'snap') return false;
    if (!logFlowOpen.current) setClosing(true);
    return true;
  });
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => BackHandler.exitApp(), CLOSE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [closing]);
  const [tab, setTabState] = useState<Tab>('crave');
  // Which way the last air swipe went, so the new tab slides in from that side (null: a tap).
  const [tabFrom, setTabFrom] = useState<'left' | 'right' | null>(null);
  const setTab = useCallback((t: Tab) => {
    setTabFrom(null);
    setTabState(t);
  }, []);
  const swipeTab = useCallback((t: Tab, from: 'left' | 'right') => {
    setTabFrom(from);
    setTabState(t);
  }, []);
  const [logs, setLogs] = useState<RemoteLog[] | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [logFlow, setLogFlow] = useState<{ open: boolean; prefill?: OverlayDish }>({ open: false });
  logFlowOpen.current = logFlow.open;
  const [labOpen, setLabOpen] = useState(false);

  const loadLogs = useCallback(async () => {
    const res = await getMyLogs();
    if (res.ok && 'logs' in res) {
      setLogs(res.logs);
      setLogsError(null);
    } else {
      setLogsError(res.error ?? "Couldn't load your Bhookmarks.");
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const openLog = useCallback((prefill?: OverlayDish) => setLogFlow({ open: true, prefill }), []);
  const closeLog = useCallback(() => setLogFlow({ open: false }), []);

  const renderDetail = useCallback(
    (dish: OverlayDish, close: () => void) =>
      dish.log ? (
        <LogDetail log={dish.log} />
      ) : (
        <DishActions
          dish={dish}
          onLog={() => {
            close();
            openLog(dish);
          }}
        />
      ),
    [openLog],
  );

  return (
    <SavesProvider>
      <CardOverlayProvider renderDetail={renderDetail}>
        {/* Touch always wins: any touch cancels an air gesture in progress. */}
        <View style={[styles.fill, { backgroundColor: c.bg }]} onTouchStart={handsFreeOn ? interrupt : undefined}>
          <OverlayStage>
            <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
              <TabSwipe tab={tab} onSwipe={swipeTab} enabled={!logFlow.open}>
              <Animated.View
                key={tab}
                entering={(tabFrom === 'right' ? FadeInRight : tabFrom === 'left' ? FadeInLeft : FadeIn).duration(timing.tab)}
                style={styles.fill}
              >
                {tab === 'crave' && <CraveScreen />}
                {tab === 'bhookmarks' && (
                  <BhookmarksScreen
                    logs={logs}
                    logsError={logsError}
                    refreshing={refreshing}
                    onRefresh={async () => {
                      setRefreshing(true);
                      await loadLogs();
                      setRefreshing(false);
                    }}
                    onLogFirst={() => openLog()}
                  />
                )}
                {tab === 'circles' && <CirclesScreen />}
                {tab === 'you' && <YouScreen onOpenLab={__DEV__ ? () => setLabOpen(true) : undefined} />}
              </Animated.View>
              </TabSwipe>
            </SafeAreaView>
          </OverlayStage>
          <BottomNav active={tab} onChange={setTab} onBite={() => openLog()} />
          <CardOverlayLayer />
          {logFlow.open && (
            <Animated.View entering={SlideInDown.duration(280)} exiting={SlideOutDown.duration(220)} style={StyleSheet.absoluteFill}>
              <LogFlow prefill={logFlow.prefill} onClose={closeLog} onLogged={() => loadLogs()} />
            </Animated.View>
          )}
          <HandsFreePill />
          <HandsFreeIntro />
          {closing && (
            <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(150)} style={[StyleSheet.absoluteFill, styles.closing, { backgroundColor: c.scrim }]}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => {
                  setClosing(false);
                  cancelSnap(); // teaches the snap learner this one wasn't meant
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel closing Bhookmark"
              >
                <View style={styles.closingBox}>
                  <Text style={[styles.closingTitle, { color: c.ink }]}>Closing Bhookmark…</Text>
                  <Text style={[styles.closingHint, { color: c.muted }]}>Tap anywhere to stay</Text>
                </View>
              </Pressable>
            </Animated.View>
          )}
          {labOpen && (
            <View style={StyleSheet.absoluteFill}>
              <MotionLab fontError={null} onClose={() => setLabOpen(false)} />
            </View>
          )}
        </View>
      </CardOverlayProvider>
    </SavesProvider>
  );
}

// How long the snap's "Closing…" notice stays up before the app exits.
const CLOSE_NOTICE_MS = 900;

// Hands-free tab switching (user request, 2026-09-18): with no dish open, a
// sideways air swipe moves between Crave, Bhookmarks and Circles, stopping at
// the ends. Quick back-to-back flicks don't switch tabs (the return stroke
// switched straight back — recording rec12, 2026-09-18). Hand moves left → next tab (like swiping a page away), right →
// previous, the same as between open dishes. While the sweep is under way the
// screen leans with the hand (reversible preview).
const SWIPE_TABS: Tab[] = ['crave', 'bhookmarks', 'circles'];
const TAB_LEAN_PX = 28;

function TabSwipe({ tab, onSwipe, enabled, children }: { tab: Tab; onSwipe: (t: Tab, from: 'left' | 'right') => void; enabled: boolean; children: ReactNode }) {
  const { activeId } = useCardOverlay();
  const { previewX } = useHandsFree();
  const i = SWIPE_TABS.indexOf(tab);
  const active = enabled && activeId === null && i >= 0;
  useHandsFreeGestures(active, (event) => {
    if (event.type !== 'swipe' || (event.direction !== 'left' && event.direction !== 'right')) return false;
    // A flick right after a swipe is usually the hand coming back: never switch tabs on it.
    if (event.flick) return true;
    const next = SWIPE_TABS[i + (event.direction === 'left' ? 1 : -1)];
    // The new tab comes in from the side the hand is moving away from.
    if (next) onSwipe(next, event.direction === 'left' ? 'right' : 'left');
    return true;
  });
  const lean = useAnimatedStyle(() => ({ transform: [{ translateX: active ? previewX.value * TAB_LEAN_PX : 0 }] }));
  return <Animated.View style={[styles.fill, lean]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  closing: { justifyContent: 'center' },
  closingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  closingTitle: { fontFamily: fonts.displayMedium, fontSize: 22 },
  closingHint: { fontFamily: fonts.body, fontSize: 14 },
  fill: { flex: 1 },
});
