import { useCallback } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

// Diagnostic only, from the native motion brief. Counts UI-thread frame
// callbacks during a scripted transition. This is NOT proof of frames the GPU
// presented — 120/90 Hz claims need Perfetto FrameTimeline (Android) or
// Instruments (iOS) on a physical release build. Use on MotionLab only.
export function useFrameProbe(active: boolean, hz: 60 | 90 | 120) {
  const count = useSharedValue(0);
  const late = useSharedValue(0);
  const longestMs = useSharedValue(0);
  const elapsedMs = useSharedValue(0);
  const skip = useSharedValue(true);

  useFrameCallback(
    useCallback(
      (frame) => {
        'worklet';
        if (!active) {
          skip.value = true;
          return;
        }
        const dt = frame.timeSincePreviousFrame;
        if (skip.value || dt === null) {
          skip.value = false;
          return;
        }
        count.value += 1;
        elapsedMs.value += dt;
        longestMs.value = Math.max(longestMs.value, dt);
        // 1.5 periods distinguishes a likely skipped callback
        // from small timer jitter. This is NOT GPU frame proof.
        if (dt > (1000 / hz) * 1.5) late.value += 1;
      },
      [active, hz, count, late, longestMs, elapsedMs, skip],
    ),
    true,
  );

  const reset = () => {
    count.value = 0;
    late.value = 0;
    longestMs.value = 0;
    elapsedMs.value = 0;
    skip.value = true;
  };

  /** Read once after motion has stopped (active=false). */
  const read = () => {
    const n = count.value;
    const elapsed = elapsedMs.value;
    return {
      callbacks: n,
      avgHz: elapsed > 0 ? (n * 1000) / elapsed : 0,
      latePct: n > 0 ? (late.value * 100) / n : 0,
      longestMs: longestMs.value,
    };
  };

  return { count, late, longestMs, elapsedMs, reset, read };
}
