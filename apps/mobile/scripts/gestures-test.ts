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

const TWO: Shape = { thumb: false, index: true, middle: true, ring: false, pinky: false };
const POINT: Shape = { thumb: false, index: true, middle: false, ring: false, pinky: false };

// --- pose classification
check('two fingers (index+middle) → two', classifyPose(pts(hand(TWO))) === 'two');
check('two fingers + thumb out → other', classifyPose(pts(hand({ ...TWO, thumb: true }))) === 'other');
check('three fingers (ring up) → other', classifyPose(pts(hand({ ...TWO, ring: true }))) === 'other');
check('two + pinky → other', classifyPose(pts(hand({ ...TWO, pinky: true }))) === 'other');
check('open palm → other', classifyPose(pts(hand({ thumb: true, index: true, middle: true, ring: true, pinky: true }))) === 'other');
check('fist → other', classifyPose(pts(hand({ thumb: false, index: false, middle: false, ring: false, pinky: false }))) === 'other');
check('index only → point', classifyPose(pts(hand(POINT))) === 'point');
check('index + thumb out → point', classifyPose(pts(hand({ ...POINT, thumb: true }))) === 'point');

// --- swipes
function run(frames: (number[] | null)[], stepMs = 66) {
  const r = new GestureRecognizer();
  const events: GestureEvent[] = [];
  frames.forEach((f, i) => events.push(...r.update(i * stepMs, f)));
  return events;
}
const sweep = (shape: Shape, from: number, to: number, n = 8) =>
  Array.from({ length: n }, (_, i) => hand(shape, from + ((to - from) * i) / (n - 1)));

let ev = run(sweep(TWO, 0.25, 0.75));
check('two-finger sweep right → one swipe right', ev.length === 1 && ev[0].type === 'swipe' && ev[0].direction === 'right', JSON.stringify(ev));
ev = run(sweep(TWO, 0.75, 0.25));
check('two-finger sweep left → one swipe left', ev.length === 1 && ev[0].type === 'swipe' && ev[0].direction === 'left', JSON.stringify(ev));
ev = run(sweep({ ...TWO, ring: true }, 0.25, 0.75));
check('three-finger sweep → no swipe', ev.length === 0, JSON.stringify(ev));
ev = run(sweep({ thumb: true, index: true, middle: true, ring: true, pinky: true }, 0.25, 0.75));
check('open-palm sweep → no swipe', ev.length === 0, JSON.stringify(ev));
ev = run(sweep(POINT, 0.25, 0.75));
check('pointing sweep → no swipe', ev.filter((e) => e.type === 'swipe').length === 0, JSON.stringify(ev));
ev = run(sweep(TWO, 0.45, 0.55));
check('small two-finger drift → no swipe', ev.length === 0, JSON.stringify(ev));
{
  const frames = sweep(TWO, 0.25, 0.75);
  frames[4] = hand({ ...TWO, ring: true }, 0.52); // a third finger appears mid-move
  ev = run(frames);
  check('ring finger appears mid-sweep → cancelled', ev.length === 0, JSON.stringify(ev));
}
ev = run(Array.from({ length: 8 }, (_, i) => hand(TWO, 0.25 + i * 0.07, 0.3 + i * 0.07)));
check('diagonal two-finger move → no swipe', ev.length === 0, JSON.stringify(ev));
ev = run([...sweep(TWO, 0.25, 0.75), ...sweep(TWO, 0.75, 0.25)], 66);
check('two quick sweeps → cooldown limits to one', ev.length === 1, JSON.stringify(ev));
ev = run([...sweep(TWO, 0.25, 0.75), ...Array(12).fill(null), ...sweep(TWO, 0.25, 0.75)], 66);
check('two sweeps a second apart → two swipes', ev.length === 2, JSON.stringify(ev));

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
  const withOpenHand = frames.map((f, i) => (i % 10 === 5 ? hand({ thumb: true, index: true, middle: true, ring: true, pinky: true }) : f));
  ev = run(withOpenHand);
  check('open hand interrupts circling → fewer steps', Math.abs(dialSum(ev)) < 4, `sum ${dialSum(ev)}`);
}
check('two-finger circle → no dial', dialSum(run(Array.from({ length: 40 }, (_, i) => hand(TWO, 0.5 + 0.1 * Math.cos(i / 6), 0.5 + 0.1 * Math.sin(i / 6))))) === 0);

ev = run(sweep(POINT, 0.2, 0.8, 16));
check('pointing straight line → no dial', dialSum(ev) === 0, `sum ${dialSum(ev)}`);
ev = run(circle(2, true, 80));
check('two clockwise turns → about +8 steps', dialSum(ev) >= 7 && dialSum(ev) <= 8, `sum ${dialSum(ev)}`);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
