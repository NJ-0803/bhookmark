// Replays a real Hands-free recording through the controller (controller.ts).
// Record: start Metro with EXPO_PUBLIC_HANDSFREE_TRACE=1; the app then logs
//   `[hfraw] {"t":…,"W":…,"H":…,"h":[…]}` for every analysed camera frame.
//   adb logcat -d -s ReactNativeJS:V > recording.log
// Run: node --experimental-strip-types scripts/gestures-replay.ts recording.log [--frames]
// Prints committed gestures, state/pose counts and (when present) timing
// percentiles; --frames adds one line per frame with each finger's measurement.
import { readFileSync } from 'node:fs';
import { HandsFreeController } from '../src/handsfree/controller.ts';
import { classifyPose, palmCenter, poseDetail, toPoints } from '../src/handsfree/gestures.ts';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('usage: gestures-replay.ts <recording.log> [--frames]');
  process.exit(2);
}
const showFrames = flags.includes('--frames');

type Frame = { t: number; W?: number; H?: number; h: number[] | null; age?: number | null; queued?: number | null; cost?: number[] };
const frames: Frame[] = [];
for (const line of readFileSync(file, 'utf8').split('\n')) {
  const i = line.indexOf('[hfraw] ');
  if (i < 0) continue;
  try {
    frames.push(JSON.parse(line.slice(i + 8)));
  } catch {
    // A truncated logcat line; skip it.
  }
}
if (!frames.length) {
  console.error('no [hfraw] frames found');
  process.exit(1);
}

// Recordings made before sizes were logged came from the Pixel 4a's 240×320 upright frame.
const size = (f: Frame) => ({ w: f.W ?? 240, h: f.H ?? 320 });
const c = new HandsFreeController();
const t0 = frames[0].t;
const poses: Record<string, number> = { none: 0, open: 0, point: 0, other: 0 };
const states: Record<string, number> = {};
const f2 = (v: number) => v.toFixed(2);
let previews = 0;
for (const f of frames) {
  const { w, h } = size(f);
  const pts = toPoints(f.h, h / w);
  poses[pts ? classifyPose(pts) : 'none']++;
  const out = c.update({ t: f.t, w, h, hand: f.h });
  states[out.state] = (states[out.state] ?? 0) + 1;
  if (out.preview) previews++;
  if (showFrames) {
    const d = pts ? poseDetail(pts) : null;
    const m = d ? `idx ${f2(d.index)} mid ${f2(d.middle)} ring ${f2(d.ring)} pinky ${f2(d.pinky)}` : '';
    const pc = pts ? palmCenter(pts) : null;
    const p = out.preview ? ` preview ${out.preview.direction} ${f2(out.preview.progress)}` : '';
    console.log(`${String(Math.round(f.t - t0)).padStart(6)}ms  ${out.state.padEnd(10)} ${m}${pc ? ` palm ${f2(pc.x)},${f2(pc.y)}` : ''}${p}${out.events.length ? '  → ' + JSON.stringify(out.events) : ''}`);
  } else {
    for (const e of out.events) console.log(`${String(Math.round(f.t - t0)).padStart(6)}ms  ${JSON.stringify(e)}`);
  }
}
const span = (frames[frames.length - 1].t - t0) / 1000;
console.log(`\n${frames.length} frames over ${span.toFixed(1)} s (${(frames.length / span).toFixed(1)} fps)`);
console.log(`poses ${JSON.stringify(poses)}  states ${JSON.stringify(states)}  preview frames ${previews}`);

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const report = (name: string, xs: number[]) => {
  if (xs.length) console.log(`${name.padEnd(22)} p50 ${pct(xs, 0.5).toFixed(1)}  p95 ${pct(xs, 0.95).toFixed(1)}  p99 ${pct(xs, 0.99).toFixed(1)} ms  (n=${xs.length})`);
};
const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t);
report('capture interval', gaps);
report('capture → JS', frames.flatMap((f) => (f.age != null ? [f.age] : [])));
report('capture → analyser', frames.flatMap((f) => (f.queued != null ? [f.queued] : [])));
report('copy+rotate', frames.flatMap((f) => (f.cost ? [f.cost[0]] : [])));
report('hand model (hand seen)', frames.flatMap((f) => (f.cost && f.h ? [f.cost[2]] : [])));
report('hand model (no hand)', frames.flatMap((f) => (f.cost && !f.h ? [f.cost[2]] : [])));
