import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMyLogs, type RemoteLog } from '../api/client';
import BottomNav, { type Tab } from '../components/BottomNav';
import { CardOverlayLayer, CardOverlayProvider, OverlayStage, type OverlayDish } from '../components/CardOverlay';
import { DishActions, LogDetail } from '../components/DishDetail';
import { timing } from '../motion/policy';
import { SavesProvider } from '../saves/SavesProvider';
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
  const [tab, setTab] = useState<Tab>('crave');
  const [logs, setLogs] = useState<RemoteLog[] | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [logFlow, setLogFlow] = useState<{ open: boolean; prefill?: OverlayDish }>({ open: false });
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
        <View style={[styles.fill, { backgroundColor: c.bg }]}>
          <OverlayStage>
            <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
              <Animated.View key={tab} entering={FadeIn.duration(timing.tab)} style={styles.fill}>
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

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
