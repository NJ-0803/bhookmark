import { Linking } from 'react-native';
import { USING_LOCAL_API } from '../api/config';

// Measurement-only switches for profiling the card transition on a device:
// launching with `exp+bhookmark://perf?off=hud,shadow` turns those layers off.
// Ignored unless the build talks to the local test API, so a store build can
// never be put into this state.
export type PerfLayer = 'stage' | 'stagetilt' | 'stagelayer' | 'scrim' | 'shadow' | 'shell' | 'detail' | 'names' | 'hero' | 'sweep' | 'hud';

const disabled = new Set<string>();

export function perfOff(layer: PerfLayer): boolean {
  return disabled.has(layer);
}

export async function loadPerfFlags(): Promise<void> {
  if (!USING_LOCAL_API) return;
  try {
    const url = await Linking.getInitialURL();
    const match = url?.match(/[?&]off=([^&]*)/);
    if (!match) return;
    decodeURIComponent(match[1])
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => disabled.add(s));
    console.log(`[perf] layers off: ${[...disabled].join(',')}`);
  } catch {
    // No launch URL: nothing to disable.
  }
}
