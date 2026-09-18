// Off-device tests for Hands-free gesture recognition.
// Run: node --experimental-strip-types scripts/gestures-test.ts
import { classifyPose, GestureRecognizer, type GestureEvent, type Point } from '../src/handsfree/gestures.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

// Build a right hand, palm facing the camera, wrist at (cx, cy+0.2).
// Each finger is either up (extended) or curled (tip back near the palm).
type Shape = { thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean };
function hand(shape: Shape, cx = 0.5, cy = 0.5): number[] {
  const p: Point[] = new Array(21);
  const wrist = { x: cx, y: cy + 0.2 };
  p[0] = wrist;
  const fingers: [number, number, boolean][] = [
    [5, -0.06, shape.index],
    [9, -0.02, shape.middle],
    [13, 0.02, shape.ring],
    [17, 0.06, shape.pinky],
  ];
  for (const [mcp, dx, up] of fingers) {
    const base = { x: cx + dx, y: cy + 0.05 };
    p[mcp] = base;
    p[mcp + 1] = { x: base.x, y: base.y - 0.06 }; // pip
    if (up) {
      p[mcp + 2] = { x: base.x, y: base.y - 0.1 };
      p[mcp + 3] = { x: base.x, y: base.y - 0.14 };
    } else {
      p[mcp + 2] = { x: base.x, y: base.y - 0.03 };
      p[mcp + 3] = { x: base.x, y: base.y + 0.01 }; // curled back below the knuckle
    }
  }
  // Thumb: tucked across the palm, or sticking out to the side.
  p[1] = { x: cx - 0.07, y: cy + 0.15 };
  p[2] = { x: cx - 0.1, y: cy + 0.1 };
  if (shape.thumb) {
    p[3] = { x: cx - 0.14, y: cy + 0.06 };
    p[4] = { x: cx - 0.18, y: cy + 0.02 };
  } else {
    p[3] = { x: cx - 0.05, y: cy + 0.08 };
    p[4] = { x: cx - 0.01, y: cy + 0.06 };
  }
  return p.flatMap((q) => [q.x, q.y]);
}

const pts = (flat: number[]) => {
  const out: Point[] = [];
  for (let i = 0; i < 42; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
};

const OPEN: Shape = { thumb: true, index: true, middle: true, ring: true, pinky: true };
const TWO: Shape = { thumb: false, index: true, middle: true, ring: false, pinky: false };
const THREE: Shape = { thumb: false, index: true, middle: true, ring: true, pinky: false };
const POINT: Shape = { thumb: false, index: true, middle: false, ring: false, pinky: false };
const FIST: Shape = { thumb: false, index: false, middle: false, ring: false, pinky: false };

// --- pose classification
check('open palm → open', classifyPose(pts(hand(OPEN))) === 'open');
check('four fingers up, thumb tucked → open (thumb ignored)', classifyPose(pts(hand({ ...OPEN, thumb: false }))) === 'open');
check('two fingers → other', classifyPose(pts(hand(TWO))) === 'other');
check('three fingers (pinky down) → other', classifyPose(pts(hand(THREE))) === 'other');
check('open but pinky down → other', classifyPose(pts(hand({ ...OPEN, pinky: false }))) === 'other');
check('fist → other', classifyPose(pts(hand(FIST))) === 'other');
check('index only → point', classifyPose(pts(hand(POINT))) === 'point');
check('index + thumb out → point', classifyPose(pts(hand({ ...POINT, thumb: true }))) === 'point');

// --- swipes
function run(frames: (number[] | null)[], stepMs = 66) {
  const r = new GestureRecognizer();
  const events: GestureEvent[] = [];
  frames.forEach((f, i) => events.push(...r.update(i * stepMs, f)));
  return events;
}
// A sweep starts with the hand held still for HOLD frames (it has to be in view
// ~300 ms before its movement counts), then moves over n frames.
const HOLD = 6;
const sweep = (shape: Shape, from: number, to: number, n = 8) => [
  ...Array.from({ length: HOLD }, () => hand(shape, from)),
  ...Array.from({ length: n }, (_, i) => hand(shape, from + ((to - from) * i) / (n - 1))),
];
const sweepY = (shape: Shape, from: number, to: number, n = 8) => [
  ...Array.from({ length: HOLD }, () => hand(shape, 0.5, from)),
  ...Array.from({ length: n }, (_, i) => hand(shape, 0.5, from + ((to - from) * i) / (n - 1))),
];
const swipes = (e: GestureEvent[]) => e.filter((x) => x.type === 'swipe').map((x) => (x.type === 'swipe' ? x.direction : ''));
const is = (e: GestureEvent[], ...dirs: string[]) => JSON.stringify(swipes(e)) === JSON.stringify(dirs) && e.length === dirs.length;

let ev = run(sweep(OPEN, 0.25, 0.75));
check('open sweep right → one swipe right', is(ev, 'right'), JSON.stringify(ev));
ev = run(sweep(OPEN, 0.75, 0.25));
check('open sweep left → one swipe left', is(ev, 'left'), JSON.stringify(ev));
ev = run(sweepY(OPEN, 0.65, 0.3));
check('open sweep up → one swipe up', is(ev, 'up'), JSON.stringify(ev));
ev = run(sweepY(OPEN, 0.3, 0.65));
check('open sweep down → one swipe down', is(ev, 'down'), JSON.stringify(ev));
ev = run(sweep(TWO, 0.25, 0.75));
check('two-finger sweep → no swipe', ev.length === 0, JSON.stringify(ev));
ev = run(sweep(THREE, 0.25, 0.75));
check('three-finger sweep → no swipe', ev.length === 0, JSON.stringify(ev));
ev = run(sweepY(FIST, 0.65, 0.3));
check('fist sweep up → no swipe', ev.length === 0, JSON.stringify(ev));
ev = run(sweep(POINT, 0.25, 0.75));
check('pointing sweep → no swipe', swipes(ev).length === 0, JSON.stringify(ev));
ev = run(sweep(OPEN, 0.45, 0.55));
check('small open-palm drift → no swipe', ev.length === 0, JSON.stringify(ev));
{
  const frames = sweep(OPEN, 0.25, 0.75);
  frames[HOLD + 4] = null; // motion blur loses the hand for one frame
  ev = run(frames);
  check('one lost frame mid-sweep → still swipes', is(ev, 'right'), JSON.stringify(ev));
}
{
  const frames = sweep(OPEN, 0.25, 0.75);
  frames[HOLD + 3] = hand(FIST, 0.39);
  frames[HOLD + 4] = hand(FIST, 0.46); // the hand closes for two frames
  ev = run(frames);
  check('hand closes mid-sweep → cancelled', ev.length === 0, JSON.stringify(ev));
}
ev = run([...Array(HOLD).fill(hand(OPEN, 0.25, 0.3)), ...Array.from({ length: 8 }, (_, i) => hand(OPEN, 0.25 + i * 0.07, 0.3 + i * 0.05))]);
check('diagonal open move → no swipe', ev.length === 0, JSON.stringify(ev));
{
  // The hand appears at the bottom edge and rises into view, no hold first.
  ev = run(Array.from({ length: 8 }, (_, i) => hand(OPEN, 0.5, 0.75 - i * 0.05)));
  check('open hand rising into view → no swipe', ev.length === 0, JSON.stringify(ev));
}
// The hand drifts straight back down, no pause (a pause and a new sweep is a real swipe down).
ev = run([...sweepY(OPEN, 0.65, 0.3), ...Array.from({ length: 8 }, (_, i) => hand(OPEN, 0.5, 0.3 + i * 0.05))]);
check('swipe up then bring the hand back → only up', is(ev, 'up'), JSON.stringify(ev));
ev = run([...sweepY(OPEN, 0.65, 0.3), ...Array(12).fill(null), ...sweepY(OPEN, 0.65, 0.3)]);
check('two swipes up a second apart → two swipes up', is(ev, 'up', 'up'), JSON.stringify(ev));
ev = run([...sweep(OPEN, 0.25, 0.75), ...Array(16).fill(null), ...sweep(OPEN, 0.75, 0.25)]);
check('right, then left well after → both', is(ev, 'right', 'left'), JSON.stringify(ev));

// --- dial (pointing circles)
function circle(turns: number, clockwise: boolean, n = 40): number[][] {
  return Array.from({ length: n }, (_, i) => {
    const a = (clockwise ? 1 : -1) * (i / (n - 1)) * turns * 2 * Math.PI;
    // Move the whole hand so the index tip traces the circle.
    const tipOffsetX = -0.06;
    const tipOffsetY = 0.05 - 0.14;
    const tx = 0.5 + 0.1 * Math.cos(a);
    const ty = 0.5 + 0.1 * Math.sin(a);
    return hand(POINT, tx - tipOffsetX, ty - tipOffsetY);
  });
}
const dialSum = (e: GestureEvent[]) => e.reduce((a, x) => a + (x.type === 'dial' ? x.steps : 0), 0);
ev = run(circle(1, true));
check('one clockwise turn → about +4 steps', dialSum(ev) >= 3 && dialSum(ev) <= 4, `sum ${dialSum(ev)}`);
ev = run(circle(1, false));
check('one anticlockwise turn → about −4 steps', dialSum(ev) <= -3 && dialSum(ev) >= -4, `sum ${dialSum(ev)}`);
ev = run(Array.from({ length: 40 }, () => hand(POINT, 0.5 + (Math.random() - 0.5) * 0.01, 0.5)));
check('pointing but still (jitter) → no steps', dialSum(ev) === 0, `sum ${dialSum(ev)}`);
{
  const frames = circle(1, true);
  const withOpenHand = frames.map((f, i) => (i % 10 === 5 ? hand(OPEN) : f));
  ev = run(withOpenHand);
  check('open hand interrupts circling → fewer steps', Math.abs(dialSum(ev)) < 4, `sum ${dialSum(ev)}`);
}
check('open-palm circle → no dial', dialSum(run(Array.from({ length: 40 }, (_, i) => hand(OPEN, 0.5 + 0.1 * Math.cos(i / 6), 0.5 + 0.1 * Math.sin(i / 6))))) === 0);

ev = run(sweep(POINT, 0.2, 0.8, 16));
check('pointing straight line → no dial', dialSum(ev) === 0, `sum ${dialSum(ev)}`);
ev = run(circle(2, true, 80));
check('two clockwise turns → about +8 steps', dialSum(ev) >= 7 && dialSum(ev) <= 8, `sum ${dialSum(ev)}`);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
