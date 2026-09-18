// Replays a real Hands-free recording through the gesture recogniser.
// Record: a test build logs `[hfraw] {"t":…,"h":[…]}` for every camera frame;
//   adb logcat -s ReactNativeJS:V | grep hfraw > recording.log
// Run: node --experimental-strip-types scripts/gestures-replay.ts recording.log [--frames]
// Prints the gestures fired and pose counts; --frames adds one line per frame
// with each finger's measurement, so a flickering pose shows which check failed.
import { readFileSync } from 'node:fs';
import { classifyPose, GestureRecognizer, poseDetail, toPoints } from '../src/handsfree/gestures.ts';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('usage: gestures-replay.ts <recording.log> [--frames]');
  process.exit(2);
}
const showFrames = flags.includes('--frames');

type Frame = { t: number; h: number[] | null };
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

const r = new GestureRecognizer();
const t0 = frames[0].t;
const counts: Record<string, number> = { none: 0, open: 0, point: 0, other: 0 };
const f2 = (v: number) => v.toFixed(2);
for (const f of frames) {
  const pts = f.h ? toPoints(f.h) : null;
  const seen = pts ? classifyPose(pts) : 'none';
  counts[seen]++;
  const events = r.update(f.t, f.h);
  if (showFrames) {
    const d = pts ? poseDetail(pts) : null;
    const m = d ? `idx ${f2(d.index)} mid ${f2(d.middle)} ring ${f2(d.ring)} pinky ${f2(d.pinky)} thumb ${f2(d.thumb)}` : '';
    const palm = pts ? [0, 5, 9, 13, 17].map((i) => pts[i]) : null;
    const x = palm ? ` palm ${f2(palm.reduce((a, p) => a + p.x, 0) / 5)},${f2(palm.reduce((a, p) => a + p.y, 0) / 5)}` : '';
    console.log(`${String(f.t - t0).padStart(6)}ms  ${seen.padEnd(5)} stable ${r.currentPose.padEnd(5)} ${m}${x}${events.length ? '  → ' + JSON.stringify(events) : ''}`);
  } else {
    for (const e of events) console.log(`${String(f.t - t0).padStart(6)}ms  ${JSON.stringify(e)}`);
  }
}
const span = (frames[frames.length - 1].t - t0) / 1000;
console.log(`\n${frames.length} frames over ${span.toFixed(1)} s (${(frames.length / span).toFixed(1)} fps)  poses: ${JSON.stringify(counts)}`);
