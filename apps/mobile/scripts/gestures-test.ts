// Off-device tests for Hands-free: pose classification (gestures.ts) and the
// preview/commit/rearm controller (controller.ts). Deterministic: no Math.random.
// Run: node --experimental-strip-types scripts/gestures-test.ts
import { HandsFreeController, type ControllerOutput } from '../src/handsfree/controller.ts';
import { classifyPose, toPoints, type GestureEvent } from '../src/handsfree/gestures.ts';
import { GestureLearner, SHAPE_WINDOW_MAX_MS, SNAP_CEIL, SNAP_FLOOR, SWIPE_FLOOR, SnapLearner } from '../src/handsfree/learning.ts';
import { DEFAULT_SNAP_TUNING, DEFAULT_TUNING } from '../src/handsfree/controller.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

// The Pixel 4a's upright analysis frame; landmarks are normalised to it.
const W = 240;
const H = 320;

// A right hand, palm facing the camera, wrist at (cx, cy+0.2) in normalised
// frame coordinates. Each finger is either up (extended) or curled.
type Curl = boolean | 'half';
type Shape = { thumb: boolean; index: Curl; middle: Curl; ring: Curl; pinky: Curl };
type P = { x: number; y: number };
/** Moves individual landmarks (index → absolute position relative to the hand centre). */
type Overrides = Record<number, [number, number]>;
function hand(shape: Shape, cx = 0.5, cy = 0.5, over: Overrides = {}): number[] {
  const p: P[] = new Array(21);
  p[0] = { x: cx, y: cy + 0.2 };
  const fingers: [number, number, Curl][] = [
    [5, -0.06, shape.index],
    [9, -0.02, shape.middle],
    [13, 0.02, shape.ring],
    [17, 0.06, shape.pinky],
  ];
  for (const [mcp, dx, up] of fingers) {
    const base = { x: cx + dx, y: cy + 0.05 };
    p[mcp] = base;
    p[mcp + 1] = { x: base.x, y: base.y - 0.06 }; // pip
    if (up === 'half') {
      p[mcp + 2] = { x: base.x, y: base.y - 0.075 };
      p[mcp + 3] = { x: base.x, y: base.y - 0.072 }; // tip back at about the middle joint's height
    } else if (up) {
      p[mcp + 2] = { x: base.x, y: base.y - 0.1 };
      p[mcp + 3] = { x: base.x, y: base.y - 0.14 };
    } else {
      p[mcp + 2] = { x: base.x, y: base.y - 0.03 };
      p[mcp + 3] = { x: base.x, y: base.y + 0.01 }; // curled back below the knuckle
    }
  }
  p[1] = { x: cx - 0.07, y: cy + 0.15 };
  p[2] = { x: cx - 0.1, y: cy + 0.1 };
  if (shape.thumb) {
    p[3] = { x: cx - 0.14, y: cy + 0.06 };
    p[4] = { x: cx - 0.18, y: cy + 0.02 };
  } else {
    p[3] = { x: cx - 0.05, y: cy + 0.08 };
    p[4] = { x: cx - 0.01, y: cy + 0.06 };
  }
  for (const [i, [dx, dy]] of Object.entries(over)) p[Number(i)] = { x: cx + dx, y: cy + dy };
  return p.flatMap((q) => [q.x, q.y]);
}

const OPEN: Shape = { thumb: true, index: true, middle: true, ring: true, pinky: true };
const TWO: Shape = { thumb: false, index: true, middle: true, ring: false, pinky: false };
const THREE: Shape = { thumb: false, index: true, middle: true, ring: true, pinky: false };
const POINT: Shape = { thumb: false, index: true, middle: false, ring: false, pinky: false };
const FIST: Shape = { thumb: false, index: false, middle: false, ring: false, pinky: false };
const HALF: Shape = { thumb: false, index: 'half', middle: 'half', ring: 'half', pinky: 'half' };
// Pyramid: all five fingertips pinched together above the palm, fingers straight.
const PYRAMID_TIPS: Overrides = { 4: [-0.02, -0.11], 8: [-0.025, -0.12], 12: [-0.015, -0.125], 16: [-0.005, -0.12], 20: [0.0, -0.115] };
const pyramidHand = (cx = 0.5, cy = 0.5) => hand(OPEN, cx, cy, PYRAMID_TIPS);
// Snap-ready: thumb tip on the middle fingertip, ring and little finger curled.
const SNAP_READY: Overrides = { 12: [-0.03, -0.05], 11: [-0.025, -0.03], 4: [-0.035, -0.05], 3: [-0.06, 0.0] };
const snapReadyHand = (cx = 0.5, cy = 0.5) => hand({ thumb: false, index: true, middle: true, ring: false, pinky: false }, cx, cy, SNAP_READY);
// Getting into snap shape: ring and little finger folded, thumb near (not yet on) the middle fingertip.
const snapApproachHand = (cx = 0.5, cy = 0.5) =>
  hand({ thumb: false, index: true, middle: true, ring: false, pinky: false }, cx, cy, { ...SNAP_READY, 4: [-0.05, -0.02] });
// Just snapped: middle finger down in the palm, thumb flicked out beside the index finger.
const snappedHand = (cx = 0.5, cy = 0.5) =>
  hand({ thumb: true, index: true, middle: false, ring: false, pinky: false }, cx, cy, { 4: [-0.12, -0.08], 3: [-0.1, -0.02] });

// Small deterministic PRNG for jitter.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const pose = (shape: Shape) => {
  const pts = toPoints(hand(shape), H / W);
  return pts ? classifyPose(pts) : 'invalid';
};

// --- pose classification
check('open palm → open', pose(OPEN) === 'open');
check('four fingers up, thumb tucked → open (thumb ignored)', pose({ ...OPEN, thumb: false }) === 'open');
check('two fingers → other', pose(TWO) === 'other');
check('three fingers (pinky down) → other', pose(THREE) === 'other');
check('open but pinky down → other', pose({ ...OPEN, pinky: false }) === 'other');
check('fist → fist', pose(FIST) === 'fist');
check('index only → point', pose(POINT) === 'point');
check('index + thumb out → point', pose({ ...POINT, thumb: true }) === 'point');
const poseOf = (flat: number[]) => {
  const pts = toPoints(flat, H / W);
  return pts ? classifyPose(pts) : 'invalid';
};
check('fingertips pinched together → pyramid', poseOf(pyramidHand()) === 'pyramid', poseOf(pyramidHand()));
check('thumb on middle fingertip → snap-ready', poseOf(snapReadyHand()) === 'snapReady', poseOf(snapReadyHand()));
check('half-curled fingers → other (neither open nor fist)', pose(HALF) === 'other', pose(HALF));
check('open palm is not a pyramid', pose(OPEN) !== 'pyramid');
check('pointing (thumb on curled middle) is not snap-ready', poseOf(hand(POINT, 0.5, 0.5, { 4: [-0.02, 0.06] })) === 'point');
check('malformed: wrong length → invalid', toPoints([0.1, 0.2], 1) === null);
check('malformed: NaN → invalid', toPoints(hand(OPEN).map((v, i) => (i === 7 ? NaN : v)), 1) === null);
check('malformed: far outside frame → invalid', toPoints(hand(OPEN).map((v, i) => (i === 0 ? 4 : v)), 1) === null);
check('malformed: zero-size frame → invalid', toPoints(hand(OPEN), NaN) === null);

// --- controller harness
type Frame = number[] | null;
type Run = { events: GestureEvent[]; outs: ControllerOutput[] };
function run(frames: Frame[], stepMs = 55, opts: { times?: number[]; c?: HandsFreeController } = {}): Run {
  const c = opts.c ?? new HandsFreeController();
  const events: GestureEvent[] = [];
  const outs: ControllerOutput[] = [];
  frames.forEach((f, i) => {
    const out = c.update({ t: opts.times ? opts.times[i] : 1000 + i * stepMs, w: W, h: H, hand: f });
    outs.push(out);
    events.push(...out.events);
  });
  return { events, outs };
}
const still = (shape: Shape, x: number, y: number, n: number): Frame[] => Array.from({ length: n }, () => hand(shape, x, y));
const move = (shape: Shape, from: [number, number], to: [number, number], n: number): Frame[] =>
  Array.from({ length: n }, (_, i) => hand(shape, from[0] + ((to[0] - from[0]) * (i + 1)) / n, from[1] + ((to[1] - from[1]) * (i + 1)) / n));
// Raise an open palm, hold it (arming), then sweep.
const HOLD = 8; // 8 × 55 ms = 440 ms > ARM_MS
const sweep = (shape: Shape, from: [number, number], to: [number, number], n = 6) => [...still(shape, from[0], from[1], HOLD), ...move(shape, from, to, n)];
const swipes = (e: GestureEvent[]) => e.filter((x) => x.type === 'swipe').map((x) => (x.type === 'swipe' ? x.direction : ''));
const only = (e: GestureEvent[], ...dirs: string[]) => e.length === dirs.length && JSON.stringify(swipes(e)) === JSON.stringify(dirs);
const show = (r: Run) => JSON.stringify(r.events);

// --- swipes: the four directions
let r = run(sweep(OPEN, [0.3, 0.5], [0.7, 0.5]));
check('open sweep right → one swipe right', only(r.events, 'right'), show(r));
r = run(sweep(OPEN, [0.7, 0.5], [0.3, 0.5]));
check('open sweep left → one swipe left', only(r.events, 'left'), show(r));
r = run(sweep(OPEN, [0.5, 0.6], [0.5, 0.3]));
check('open sweep up → one swipe up', only(r.events, 'up'), show(r));
r = run(sweep(OPEN, [0.5, 0.3], [0.5, 0.6]));
check('open sweep down → one swipe down', only(r.events, 'down'), show(r));

// --- preview before commit
{
  r = run(sweep(OPEN, [0.5, 0.6], [0.5, 0.3]));
  const firstPreview = r.outs.findIndex((o) => o.preview !== null);
  const commitAt = r.outs.findIndex((o) => o.events.length > 0);
  check('preview starts before the commit', firstPreview >= 0 && firstPreview < commitAt, `preview@${firstPreview} commit@${commitAt}`);
  const progress = r.outs.slice(firstPreview, commitAt).map((o) => o.preview?.progress ?? -1);
  check('preview progress rises towards 1', progress.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= progress[i - 1])), progress.map((p) => p.toFixed(2)).join(' '));
  check('state is armed before the sweep and previewing during it', r.outs[HOLD - 1].state === 'armed' && r.outs[firstPreview].state === 'previewing');
}
{
  // A partial sweep that comes back: preview shows, nothing commits.
  r = run([...still(OPEN, 0.5, 0.55, HOLD), ...move(OPEN, [0.5, 0.55], [0.5, 0.49], 3), ...move(OPEN, [0.5, 0.49], [0.5, 0.56], 4), ...still(OPEN, 0.5, 0.56, 4)]);
  check('partial sweep then back → preview but no commit', r.events.length === 0 && r.outs.some((o) => o.preview), show(r));
  check('abandoned preview clears', r.outs[r.outs.length - 1].preview === null);
  check('pulling back after an abandoned preview does not preview the other way', !r.outs.some((o) => o.preview?.direction === 'down'));
}

// --- shapes and motions that must not swipe
// Any hand shape swipes (user decision, 2026-09-18).
r = run(sweep(TWO, [0.5, 0.6], [0.5, 0.3]));
check('two-finger sweep up → one swipe up', only(r.events, 'up'), show(r));
r = run(sweep(THREE, [0.3, 0.5], [0.7, 0.5]));
check('three-finger sweep right → one swipe right', only(r.events, 'right'), show(r));
r = run(sweep(FIST, [0.5, 0.3], [0.5, 0.6]));
check('fist sweep down → one swipe down (not a release)', only(r.events, 'down'), show(r));
r = run(sweep(POINT, [0.5, 0.6], [0.5, 0.3]));
check('pointing sweep up → one swipe up (no rating dial on screen)', only(r.events, 'up'), show(r));
{
  const c = new HandsFreeController();
  c.setDialEnabled(true);
  r = run(sweep(POINT, [0.5, 0.6], [0.5, 0.3]), 55, { c });
  check('pointing sweep on the rating screen → no swipe (the finger dials there)', swipes(r.events).length === 0, show(r));
}
r = run(sweep(snapReadyHand(), [0.5, 0.6], [0.5, 0.3]).map(() => snapReadyHand()));
check('snap set-up held still → no swipe', swipes(r.events).length === 0, show(r));
{
  // Regression (recording, 2026-09-18): a long "Ready" hold, then an up swipe
  // that takes a few frames. It was cancelled one frame into its preview.
  r = run([...still(OPEN, 0.5, 0.62, 20), ...move(OPEN, [0.5, 0.62], [0.5, 0.35], 7)]);
  check('up swipe after a long Ready hold → one swipe up', only(r.events, 'up'), show(r));
  r = run([...still(OPEN, 0.5, 0.35, 20), ...move(OPEN, [0.5, 0.35], [0.5, 0.62], 7)]);
  check('down swipe after a long Ready hold → one swipe down', only(r.events, 'down'), show(r));
  r = run([...still(OPEN, 0.5, 0.6, 20), ...move(OPEN, [0.5, 0.6], [0.5, 0.56], 14), ...still(OPEN, 0.5, 0.56, 10)]);
  check('a slow up drift after a long hold → no swipe', r.events.length === 0, show(r));
}
r = run(sweep(OPEN, [0.47, 0.5], [0.53, 0.5]));
check('small open-palm drift → no swipe', r.events.length === 0, show(r));
r = run(sweep(OPEN, [0.3, 0.35], [0.6, 0.6]));
check('diagonal open move → no swipe', r.events.length === 0, show(r));
r = run(move(OPEN, [0.5, 0.75], [0.5, 0.35], 8));
check('open hand rising into view (no hold) → no swipe', r.events.length === 0, show(r));
r = run(move(OPEN, [0.5, 0.8], [0.5, 0.25], 14));
check('open hand still rising 770 ms after entering → no swipe', r.events.length === 0, show(r));
{
  const jitter = rng(7);
  const frames = Array.from({ length: 60 }, () => hand(OPEN, 0.5 + (jitter() - 0.5) * 0.02, 0.5 + (jitter() - 0.5) * 0.02));
  r = run(frames);
  check('held open palm with tracking jitter → no swipe', r.events.length === 0, show(r));
}
{
  // A slower sweep (commits around the 4th moving sample), interrupted before that.
  const frames = sweep(OPEN, [0.3, 0.5], [0.7, 0.5], 12);
  frames[HOLD + 1] = hand(FIST, 0.37);
  frames[HOLD + 2] = hand(FIST, 0.4);
  frames[HOLD + 3] = hand(FIST, 0.43); // the hand closes for ~165 ms mid-sweep
  r = run(frames);
  check('hand closes mid-sweep → the swipe carries on (any shape swipes)', only(r.events, 'right'), show(r));
}

// --- tracking gaps, timing and bad data
{
  const frames = sweep(OPEN, [0.3, 0.5], [0.7, 0.5]);
  frames[HOLD + 2] = null; // motion blur loses the hand for one sample
  r = run(frames);
  check('one lost sample mid-sweep → still swipes', only(r.events, 'right'), show(r));
}
{
  const frames = sweep(OPEN, [0.3, 0.5], [0.7, 0.5], 12);
  const times = frames.map((_, i) => 1000 + i * 55 + (i > HOLD + 1 ? 400 : 0)); // 400 ms stall before commit
  r = run(frames, 55, { times });
  check('stale data (400 ms gap) mid-sweep → cancelled', r.events.length === 0, show(r));
}
{
  const frames = sweep(OPEN, [0.3, 0.5], [0.7, 0.5]);
  const times = frames.map((_, i) => 1000 + i * 55);
  [times[HOLD + 3], times[HOLD + 4]] = [times[HOLD + 4], times[HOLD + 3]]; // delivered out of order
  r = run(frames, 55, { times });
  check('out-of-order sample is dropped → still one swipe', only(r.events, 'right'), show(r));
}
{
  const frames = sweep(OPEN, [0.3, 0.5], [0.7, 0.5]);
  frames[HOLD + 2] = hand(OPEN, 0.95, 0.1); // a one-sample tracking glitch
  r = run(frames);
  check('implausible one-sample jump is ignored', only(r.events, 'right'), show(r));
}
{
  const frames = sweep(OPEN, [0.3, 0.5], [0.7, 0.5]);
  frames[HOLD + 1] = hand(OPEN, 0.4).map((v, i) => (i === 3 ? Number.POSITIVE_INFINITY : v));
  r = run(frames);
  check('malformed sample mid-sweep → treated as a gap', only(r.events, 'right'), show(r));
}
for (const fps of [10, 18, 30]) {
  const step = 1000 / fps;
  const holdN = Math.ceil(420 / step);
  const moveN = Math.max(3, Math.round(300 / step)); // the same 300 ms sweep at every frame rate
  const frames = [...still(OPEN, 0.3, 0.5, holdN), ...move(OPEN, [0.3, 0.5], [0.7, 0.5], moveN)];
  r = run(frames, step);
  check(`same sweep at ${fps} fps → one swipe right`, only(r.events, 'right'), show(r));
}
{
  // Arming is time-based: 250 ms of open palm is not enough, whatever the frame rate.
  // Open at 0 ms, sweep from 150 to 270 ms, then hold still: the motion happened before arming.
  r = run([...still(OPEN, 0.3, 0.5, 5), ...move(OPEN, [0.3, 0.5], [0.7, 0.5], 4), ...still(OPEN, 0.7, 0.5, 10)], 30);
  check('a sweep made before the 300 ms arming → no swipe', r.events.length === 0, show(r));
}

// --- exactly once, return stroke, rearm
r = run(sweep(OPEN, [0.3, 0.5], [0.8, 0.5], 10));
check('long sweep → exactly one swipe', only(r.events, 'right'), show(r));
// Returns at a realistic pace (~1.5–2 palm/s, as recorded) versus a deliberate flick.
r = run([...sweep(OPEN, [0.5, 0.6], [0.5, 0.3]), ...move(OPEN, [0.5, 0.3], [0.5, 0.6], 26)]);
check('swipe up then slowly bring the hand back → only up', only(r.events, 'up'), show(r));
r = run([...sweep(OPEN, [0.5, 0.6], [0.5, 0.3]), ...move(OPEN, [0.5, 0.3], [0.5, 0.6], 26), ...still(OPEN, 0.5, 0.6, 5), ...move(OPEN, [0.5, 0.6], [0.5, 0.3], 6)]);
check('up, slow return, settle, up again → two swipes up', only(r.events, 'up', 'up'), show(r));
r = run([...sweep(OPEN, [0.5, 0.3], [0.5, 0.6]), ...move(OPEN, [0.5, 0.6], [0.5, 0.3], 5)]);
check('down, then a quick flick straight back up → down, up', only(r.events, 'down', 'up'), show(r));
r = run([...sweep(OPEN, [0.5, 0.3], [0.5, 0.65], 12)]);
check('one long down sweep → still one swipe (no flick from its own tail)', only(r.events, 'down'), show(r));
r = run([...sweep(OPEN, [0.3, 0.5], [0.7, 0.5]), ...Array(10).fill(null), ...sweep(OPEN, [0.7, 0.5], [0.3, 0.5])]);
check('right, hand leaves, then left → both', only(r.events, 'right', 'left'), show(r));
{
  const c = new HandsFreeController();
  const frames = sweep(OPEN, [0.3, 0.5], [0.7, 0.5], 12);
  const events: GestureEvent[] = [];
  frames.forEach((f, i) => {
    if (i === HOLD + 2) c.interrupt(); // a touch lands mid-sweep, before the commit
    events.push(...c.update({ t: 1000 + i * 55, w: W, h: H, hand: f }).events);
  });
  check('touch mid-sweep → no swipe', events.length === 0, JSON.stringify(events));
}
{
  const c = new HandsFreeController();
  run(sweep(OPEN, [0.3, 0.5], [0.7, 0.5]), 55, { c });
  c.reset();
  r = run(sweep(OPEN, [0.7, 0.5], [0.3, 0.5]), 55, { c });
  check('reset clears the rearm lockout', only(r.events, 'left'), show(r));
}

// --- close / open (grab / release)
const types = (e: GestureEvent[]) => e.map((x) => x.type);
{
  r = run([...still(OPEN, 0.5, 0.5, HOLD), hand(HALF), hand(HALF), hand(FIST), hand(FIST), ...still(FIST, 0.5, 0.5, 3)]);
  check('Ready palm closes into a fist → one grab', JSON.stringify(types(r.events)) === '["grab"]', show(r));
  const closing = r.outs.filter((o) => o.state === 'closing');
  check('closing previews the list moving down', closing.length > 0 && closing.every((o) => o.preview?.direction === 'down'), JSON.stringify(closing.map((o) => o.preview)));
}
r = run([...still(OPEN, 0.5, 0.5, 3), hand(HALF), hand(FIST), ...still(FIST, 0.5, 0.5, 3)]);
check('closing an un-armed (just raised) palm → no grab', r.events.length === 0, show(r));
r = run([...still(OPEN, 0.5, 0.5, HOLD), ...Array(12).fill(hand(HALF)), hand(FIST), hand(FIST)]);
check('closing slowly (> 600 ms) → no grab', r.events.length === 0, show(r));
r = run([...still(OPEN, 0.5, 0.5, HOLD), hand(HALF), ...still(OPEN, 0.5, 0.5, 6)]);
check('half-close then open again → no grab', r.events.length === 0, show(r));
{
  r = run([...still(FIST, 0.5, 0.5, 8), hand(HALF), hand(OPEN), ...still(OPEN, 0.5, 0.5, 3)]);
  check('held fist opens into a palm → one release', JSON.stringify(types(r.events)) === '["release"]', show(r));
  check('opening previews the list moving up', r.outs.some((o) => o.state === 'opening' && o.preview?.direction === 'up'));
}
r = run([...still(FIST, 0.5, 0.5, 3), hand(HALF), hand(OPEN), ...still(OPEN, 0.5, 0.5, 3)]);
check('fist held only 165 ms then opened → no release', r.events.length === 0, show(r));
r = run([...move(FIST, [0.3, 0.5], [0.7, 0.5], 10), hand(OPEN, 0.7), hand(OPEN, 0.7)]);
check('a moving fist that opens → no release', r.events.length === 0, show(r));
r = run([...still(OPEN, 0.5, 0.5, HOLD), hand(HALF), hand(FIST), ...still(FIST, 0.5, 0.5, 8), hand(HALF), hand(OPEN), ...still(OPEN, 0.5, 0.5, 3)]);
check('close, hold, open → grab then release', JSON.stringify(types(r.events)) === '["grab","release"]', show(r));
{
  const jitter = rng(3);
  // Holding cutlery: the hand hovers half-closed and fidgets; never a held open palm or held fist.
  const frames = Array.from({ length: 80 }, (_, i) => hand(i % 7 < 4 ? HALF : TWO, 0.5 + (jitter() - 0.5) * 0.04, 0.5 + (jitter() - 0.5) * 0.04));
  r = run(frames);
  check('fidgeting half-closed hand (eating) → nothing', r.events.length === 0, show(r));
}

// --- bloom (pyramid → open)
r = run([...Array(6).fill(pyramidHand()), hand(OPEN), hand(OPEN), ...still(OPEN, 0.5, 0.5, 3)]);
check('pyramid held, then opened → one bloom', JSON.stringify(types(r.events)) === '["bloom"]', show(r));
r = run([pyramidHand(), pyramidHand(), hand(OPEN), ...still(OPEN, 0.5, 0.5, 3)]);
check('pyramid held only 55 ms → no bloom', r.events.length === 0, show(r));
r = run([...Array(6).fill(pyramidHand()), ...Array(14).fill(hand(HALF)), hand(OPEN)]);
check('pyramid opened too slowly → no bloom', r.events.length === 0, show(r));
r = run([...still(FIST, 0.5, 0.5, 8), hand(OPEN), hand(OPEN)]);
check('fist → open is a release, not a bloom', JSON.stringify(types(r.events)) === '["release"]', show(r));

// --- snap
r = run([...Array(4).fill(snapReadyHand()), snappedHand(), snappedHand(), ...still(FIST, 0.5, 0.5, 3)]);
check('thumb-on-middle held, then snapped → one snap', JSON.stringify(types(r.events)) === '["snap"]', show(r));
r = run([...Array(4).fill(snapReadyHand()), hand(OPEN), hand(OPEN), hand(OPEN)]);
check('thumb-on-middle then relaxed open → no snap', !types(r.events).includes('snap'), show(r));
r = run([snappedHand(), snappedHand(), snappedHand()]);
check('snapped shape without the set-up → no snap', r.events.length === 0, show(r));
r = run([snapApproachHand(), snapReadyHand(), snappedHand(), snappedHand()]);
check('one-sample touch after a snap-shape lead-in, then snapped (a quick real snap) → one snap', JSON.stringify(types(r.events)) === '["snap"]', show(r));
{
  // Holding the set-up for ~2 s while the thumb wobbles off and back, then a real snap.
  const wobble = hand({ thumb: false, index: true, middle: true, ring: false, pinky: false }, 0.5, 0.5, { ...SNAP_READY, 4: [-0.035, -0.02] });
  const frames = [...Array(3).fill(snapReadyHand()), wobble, snapReadyHand(), snapReadyHand(), wobble, snapReadyHand(), wobble, snapReadyHand(), snapReadyHand(), snappedHand()];
  r = run(frames);
  const attempts = r.outs.flatMap((o) => (o.attempt ? [o.attempt] : []));
  check('thumb wobbles during a held set-up are not near-misses', attempts.length === 1 && attempts[0].fired, JSON.stringify(attempts));
  const L = new GestureLearner();
  for (let i = 0; i < 6; i++) L.observe({ kind: 'snap', t: 1000 + i * 100, fired: false, delta: 0.2, rate: 4 });
  L.observe({ kind: 'snap', t: 2000, fired: true, delta: 0.6, rate: 8 });
  check('one success learns at most 2 near-misses', L.examples.snap === 3, JSON.stringify(L.examples));
  check('old (v2) snap learning is dropped, the rest kept', JSON.stringify(GestureLearner.from({ v: 2, snap: { positives: Array(9).fill({ delta: 0.1, rate: 1 }) } }).tuning().snap) === JSON.stringify(DEFAULT_SNAP_TUNING));
}
r = run([...Array(4).fill(snapReadyHand()), null, null, snappedHand()], 60);
check('the snap blurs the hand out for 2 frames (~180 ms), then snapped → one snap', JSON.stringify(types(r.events)) === '["snap"]', show(r));
r = run([...Array(4).fill(snapReadyHand()), ...Array(8).fill(null), snappedHand()], 60);
check('hand gone longer than the snap window, then a snapped shape → no snap', r.events.length === 0, show(r));
r = run([hand(OPEN), snapReadyHand(), snappedHand(), snappedHand()]);
check('one-sample "touch" straight out of an open hand (a misread) → no snap', r.events.length === 0, show(r));
{
  // Thumb and middle finger fly apart fast, the fold itself falling between camera frames (most real snaps).
  const split = hand({ thumb: true, index: true, middle: true, ring: false, pinky: false }, 0.5, 0.5, { ...SNAP_READY, 4: [-0.14, -0.1] });
  r = run([...Array(3).fill(snapReadyHand()), split, split]);
  check('fast thumb–middle split without a seen fold → one snap', JSON.stringify(types(r.events)) === '["snap"]', show(r));
  const slow = Array.from({ length: 8 }, (_, i) =>
    hand({ thumb: true, index: true, middle: true, ring: false, pinky: false }, 0.5, 0.5, { ...SNAP_READY, 4: [-0.035 - i * 0.013, -0.05 - i * 0.006] }),
  );
  r = run([...Array(3).fill(snapReadyHand()), ...slow]);
  check('thumb slowly sliding off the middle finger → no snap', r.events.length === 0, show(r));
}
r = run([...Array(4).fill(snapReadyHand()), ...Array(8).fill(snapReadyHand()), ...Array(8).fill(hand(HALF)), snappedHand()]);
check('snap after the window has passed → no snap', r.events.length === 0, show(r));

// --- snap learning
{
  const L = new SnapLearner();
  check('learner starts at the default snap thresholds', JSON.stringify(L.tuning()) === JSON.stringify(DEFAULT_SNAP_TUNING));
  // A user whose snaps come apart less than the default expects: each fired
  // snap is preceded by a near-miss 0.2 palm apart at 5 palm/s.
  for (let i = 0; i < 4; i++) {
    L.observe({ t: 10000 * i, fired: false, delta: 0.2, rate: 5 });
    L.observe({ t: 10000 * i + 700, fired: true, delta: 0.6, rate: 9 });
  }
  const tuned = L.tuning();
  check('near-misses before real snaps loosen the split threshold', tuned.minDelta <= 0.2 && tuned.minDelta >= SNAP_FLOOR.minDelta, JSON.stringify(tuned));
  check('learning never goes below the floor', tuned.minRate >= SNAP_FLOOR.minRate && tuned.minDelta >= SNAP_FLOOR.minDelta);
  // The same user's style now fires through the controller.
  const c = new HandsFreeController();
  c.setTuning({ ...DEFAULT_TUNING, snap: tuned });
  // Modelled on a real near-miss (781.8 s in the 2026-09-18 recording): thumb
  // resting ~0.2 palm from the middle fingertip, then ~0.4 apart one 40 ms frame later.
  const lightTouch = hand({ thumb: false, index: true, middle: true, ring: false, pinky: false }, 0.5, 0.5, { ...SNAP_READY, 4: [-0.03, -0.02] });
  const shortSplit = hand({ thumb: false, index: true, middle: true, ring: false, pinky: false }, 0.5, 0.5, { ...SNAP_READY, 4: [-0.03, 0.01] });
  const before = run([...Array(3).fill(lightTouch), shortSplit, shortSplit], 40);
  const after = run([...Array(3).fill(lightTouch), shortSplit, shortSplit], 40, { c });
  check('a smaller split misses by default but fires once learned', before.events.length === 0 && JSON.stringify(types(after.events)) === '["snap"]', `${show(before)} → ${show(after)}`);
}
{
  const L = new SnapLearner();
  L.observe({ t: 0, fired: false, delta: 0.19, rate: 5 });
  L.observe({ t: 9000, fired: true, delta: 0.6, rate: 9 }); // 9 s later: not the same attempt
  L.observe({ t: 20000, fired: true, delta: 0.6, rate: 9 });
  L.observe({ t: 30000, fired: true, delta: 0.6, rate: 9 });
  check('a near-miss long before a snap is not learned', L.tuning().minDelta > 0.19, JSON.stringify(L.tuning()));
}
{
  const L = new SnapLearner();
  for (let i = 0; i < 4; i++) L.observe({ t: 10000 * i, fired: true, delta: 0.5, rate: 8 });
  L.observe({ t: 50000, fired: true, delta: 0.3, rate: 4 });
  L.cancelLast(); // the user tapped "stay": that one wasn't meant
  const t = L.tuning();
  check('a cancelled snap tightens the thresholds past it', !(0.3 >= t.minDelta && 4 >= t.minRate), JSON.stringify(t));
  check('tightening never exceeds the ceiling', t.minDelta <= SNAP_CEIL.minDelta && t.minRate <= SNAP_CEIL.minRate);
  const back = new SnapLearner();
  back.load(JSON.parse(JSON.stringify(L)));
  check('learning survives save and reload', JSON.stringify(back.tuning()) === JSON.stringify(t));
  const corrupt = new SnapLearner();
  corrupt.load({ positives: [{ delta: 'x' }, null], negatives: 7 });
  check('corrupt saved learning is ignored', JSON.stringify(corrupt.tuning()) === JSON.stringify(DEFAULT_SNAP_TUNING));
}

// --- swipe and close/open learning
{
  // This user's up-swipes are short and gentle: ~0.55 palm at ~2.5 palm/s,
  // which the default (0.66, or 0.45 at 3 palm/s) misses.
  const shortSwipe = () => [...still(OPEN, 0.5, 0.55, HOLD), ...move(OPEN, [0.5, 0.55], [0.5, 0.47], 8), ...still(OPEN, 0.5, 0.47, 8)];
  const def = run(shortSwipe());
  check('a short, gentle swipe misses at the default thresholds', def.events.length === 0, show(def));
  const missed = def.outs.find((o) => o.attempt)?.attempt;
  check('the miss is reported as a swipe attempt', missed?.kind === 'swipe' && !missed.fired, JSON.stringify(missed));
  const L = new GestureLearner();
  // Twice: the gentle swipe misses, then a bigger one in the same direction fires.
  for (let k = 0; k < 2; k++) {
    L.observe({ kind: 'swipe', t: 10000 * k, fired: false, direction: 'up', travel: 0.55, speed: 2.5 });
    L.observe({ kind: 'swipe', t: 10000 * k + 1500, fired: true, direction: 'up', travel: 0.7, speed: 5 });
  }
  const tuned = L.tuning();
  check('swipe near-misses followed by a swipe loosen the commit distance', tuned.swipe.commitTravel < 0.55 && tuned.swipe.commitTravel >= SWIPE_FLOOR.commitTravel, JSON.stringify(tuned.swipe));
  const c = new HandsFreeController();
  c.setTuning(tuned);
  const learned = run(shortSwipe(), 55, { c });
  check('the same gentle swipe fires once learned', only(learned.events, 'up'), show(learned));
  const drift = new HandsFreeController();
  drift.setTuning(tuned);
  const d = run(sweep(OPEN, [0.5, 0.5], [0.5, 0.47]), 55, { c: drift });
  check('a small drift still never scrolls after learning', d.events.length === 0, show(d));
}
{
  const L = new GestureLearner();
  L.observe({ kind: 'swipe', t: 0, fired: false, direction: 'down', travel: 0.5, speed: 2 });
  L.observe({ kind: 'swipe', t: 1000, fired: true, direction: 'up', travel: 0.7, speed: 5 });
  L.observe({ kind: 'swipe', t: 20000, fired: false, direction: 'up', travel: 0.5, speed: 2 });
  L.observe({ kind: 'swipe', t: 26000, fired: true, direction: 'up', travel: 0.7, speed: 5 });
  check('misses in another direction, or long before, are not learned', JSON.stringify(L.tuning().swipe) === JSON.stringify(DEFAULT_TUNING.swipe), JSON.stringify(L.tuning().swipe));
}
{
  // A slow closer: 800 ms from open to fist; the default allows 600.
  const slowClose = () => [...still(OPEN, 0.5, 0.5, HOLD), ...Array(12).fill(hand(HALF)), hand(FIST), hand(FIST)];
  check('a slow close misses at the default window', run(slowClose()).events.length === 0);
  const L = new GestureLearner();
  for (let k = 0; k < 3; k++) {
    L.observe({ kind: 'grab', t: 10000 * k, fired: false, ms: 650 });
    L.observe({ kind: 'grab', t: 10000 * k + 2000, fired: true, ms: 400 });
  }
  check('close near-misses followed by a close give more time', L.tuning().shape.grabWindowMs > 750 && L.tuning().shape.grabWindowMs <= SHAPE_WINDOW_MAX_MS, JSON.stringify(L.tuning().shape));
  const c = new HandsFreeController();
  c.setTuning(L.tuning());
  check('the same slow close fires once learned', JSON.stringify(types(run(slowClose(), 55, { c }).events)) === '["grab"]');
  for (let k = 3; k < 30; k++) {
    L.observe({ kind: 'grab', t: 10000 * k, fired: false, ms: 650 });
    L.observe({ kind: 'grab', t: 10000 * k + 2000, fired: true, ms: 400 });
  }
  check('the close window never grows past its maximum', L.tuning().shape.grabWindowMs === SHAPE_WINDOW_MAX_MS);
}
{
  const L = new GestureLearner();
  L.observe({ kind: 'swipe', t: 0, fired: false, direction: 'up', travel: 0.5, speed: 2.4 });
  L.observe({ kind: 'swipe', t: 900, fired: false, direction: 'up', travel: 0.52, speed: 2.6 });
  L.observe({ kind: 'swipe', t: 1500, fired: true, direction: 'up', travel: 0.7, speed: 5 });
  L.observe({ kind: 'grab', t: 3000, fired: false, ms: 650 });
  L.observe({ kind: 'grab', t: 4000, fired: true, ms: 400 });
  const back = GestureLearner.from(JSON.parse(JSON.stringify(L)));
  check('all gesture learning survives save and reload', JSON.stringify(back.tuning()) === JSON.stringify(L.tuning()), JSON.stringify(back.tuning()));
  check('unknown saved data falls back to defaults', JSON.stringify(GestureLearner.from({ v: 99 }).tuning()) === JSON.stringify(DEFAULT_TUNING));
}

// --- dial (pointing circles)
function circle(turns: number, clockwise: boolean, n = 40): Frame[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (clockwise ? 1 : -1) * (i / (n - 1)) * turns * 2 * Math.PI;
    // Move the whole hand so the index tip traces a circle (round in aspect-correct space).
    const tipOffsetX = -0.06;
    const tipOffsetY = 0.05 - 0.14;
    const tx = 0.5 + 0.1 * Math.cos(a);
    const ty = 0.5 + 0.1 * (W / H) * Math.sin(a);
    return hand(POINT, tx - tipOffsetX, ty - tipOffsetY);
  });
}
const withDwell = (frames: Frame[]) => [frames[0], frames[0], frames[0], ...frames];
// The rating screen turns the dial on; every dial test runs as if it's on screen.
const dialOn = () => {
  const c = new HandsFreeController();
  c.setDialEnabled(true);
  return { c };
};
const dialSum = (e: GestureEvent[]) => e.reduce((a, x) => a + (x.type === 'dial' ? x.steps : 0), 0);
r = run(withDwell(circle(1, true)), 55, dialOn());
check('one clockwise turn → about +4 steps', dialSum(r.events) >= 3 && dialSum(r.events) <= 4, `sum ${dialSum(r.events)}`);
r = run(withDwell(circle(1, false)), 55, dialOn());
check('one anticlockwise turn → about −4 steps', dialSum(r.events) <= -3 && dialSum(r.events) >= -4, `sum ${dialSum(r.events)}`);
r = run(withDwell(circle(2, true, 80)), 55, dialOn());
check('two clockwise turns → about +8 steps', dialSum(r.events) >= 7 && dialSum(r.events) <= 8, `sum ${dialSum(r.events)}`);
{
  const jitter = rng(11);
  r = run(Array.from({ length: 40 }, () => hand(POINT, 0.5 + (jitter() - 0.5) * 0.01, 0.5)), 55, dialOn());
  check('pointing but still (jitter) → no steps', dialSum(r.events) === 0, `sum ${dialSum(r.events)}`);
}
{
  const frames = withDwell(circle(1, true));
  r = run(frames.map((f, i) => (i % 10 === 5 ? hand(OPEN) : f)), 55, dialOn());
  check('open hand interrupts circling → fewer steps', Math.abs(dialSum(r.events)) < 4, `sum ${dialSum(r.events)}`);
}
r = run(Array.from({ length: 40 }, (_, i) => hand(OPEN, 0.5 + 0.1 * Math.cos(i / 6), 0.5 + 0.1 * Math.sin(i / 6))), 55, dialOn());
check('open-palm circle → no dial', dialSum(r.events) === 0);
r = run(withDwell(move(POINT, [0.2, 0.5], [0.8, 0.5], 16)), 55, dialOn());
check('pointing straight line → no dial', dialSum(r.events) === 0, `sum ${dialSum(r.events)}`);
{
  r = run(withDwell(circle(1, true)), 55, dialOn());
  check('dial state is reported while pointing', r.outs.slice(4).every((o) => o.state === 'dial'));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
