// Hands-free geometry over MediaPipe's 21 hand landmarks: validation, aspect
// correction, pose classification and the rating dial. Pure functions + a small
// dial tracker, so everything can be tested off-device. The swipe state machine
// (arming, preview, commit, rearm) lives in controller.ts.
//
// Coordinates arrive normalised 0–1 in a mirrored, upright image: x grows to the
// user's right as they face the screen, y grows downwards. toPoints() converts
// them to an aspect-correct space measured in frame widths (y is scaled by
// height/width), so distances mean the same thing along both axes.
//
// Gestures (user decisions):
// - Air swipe (2026-09-18, replacing the 2026-09-17 two-finger swipe, which was
//   hard to hold in mid-air): an open palm, all four fingers up (the thumb is
//   ignored; its reading is the noisiest). Up/down scrolls, left/right moves
//   between dishes. Any other hand shape never swipes.
// - Rating dial: a single pointing index finger drawing a circle, like BMW's
//   volume gesture. Clockwise raises, anticlockwise lowers, one step per
//   quarter turn.
// - (2026-09-18) Closing a held open palm into a fist moves the list down with
//   the fingers; opening a held fist moves it up. Fingertips pinched together
//   in a pyramid, then opened ("bloom"), opens the highlighted dish. A Thanos
//   snap (thumb and middle finger together, then snapped) closes the app.

export type Point = { x: number; y: number };
export type SwipeDirection = 'left' | 'right' | 'up' | 'down';
export type Pose = 'open' | 'point' | 'fist' | 'pyramid' | 'snapReady' | 'other';
export type GestureEvent =
  | { type: 'swipe'; direction: SwipeDirection }
  | { type: 'dial'; steps: number }
  /** A held open palm closed into a fist: the list moves down with the fingers. */
  | { type: 'grab' }
  /** A held fist opened into a palm: the list moves up. */
  | { type: 'release' }
  /** Fingertips pinched in a pyramid, then opened: open the highlighted dish. */
  | { type: 'bloom' }
  /** Thumb and middle finger snapped: close the app. */
  | { type: 'snap' };

export const WRIST = 0;
const THUMB_TIP = 4;
const TIPS = [4, 8, 12, 16, 20];
export const INDEX = { mcp: 5, pip: 6, tip: 8 };
export const MIDDLE = { mcp: 9, pip: 10, tip: 12 };
const RING = { mcp: 13, pip: 14, tip: 16 };
const PINKY = { mcp: 17, pip: 18, tip: 20 };

/**
 * Validates a flat landmark array and converts it to aspect-correct points.
 * `aspect` is the upright frame's height / width. Returns null for anything
 * malformed: wrong length, non-finite values, or coordinates far outside the
 * frame (MediaPipe allows a little overshoot at the edges).
 */
export function toPoints(flat: readonly number[] | null | undefined, aspect = 1): Point[] | null {
  if (!flat || flat.length !== 42 || !(aspect > 0) || !Number.isFinite(aspect)) return null;
  const pts: Point[] = [];
  for (let i = 0; i < 42; i += 2) {
    const x = flat[i];
    const y = flat[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -0.5 || x > 1.5 || y < -0.5 || y > 1.5) return null;
    pts.push({ x, y: y * aspect });
  }
  return pts;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

type Finger = { mcp: number; pip: number; tip: number };

/** How far each fingertip reaches from the wrist, relative to its middle joint. */
function reach(p: Point[], f: Finger): number {
  const d = dist(p[WRIST], p[f.pip]);
  return d > 1e-6 ? dist(p[WRIST], p[f.tip]) / d : 0;
}

/** Thumb tip's distance to the palm (middle/ring knuckles, index middle joint), relative to palm size. */
function thumbReach(p: Point[]): number {
  const palm = dist(p[WRIST], p[MIDDLE.mcp]);
  const near = Math.min(dist(p[THUMB_TIP], p[MIDDLE.mcp]), dist(p[THUMB_TIP], p[RING.mcp]), dist(p[THUMB_TIP], p[INDEX.pip]));
  return palm > 1e-6 ? near / palm : 0;
}

// Extended: the tip is clearly farther from the wrist than the middle joint.
// Folded: the tip has curled back to (or inside) the middle joint's reach.
const EXTENDED = 1.25;
const FOLDED = 1.05;
// Open palm, measured on real recordings (Pixel 4a, 2026-09-18): a real open
// palm reads 1.15–1.45 per finger (lower mid-sweep), while a two- or
// three-finger shape always had a folded finger at ≤1.05.
const OPEN_EXTENDED = 1.12;

/** The measurements behind a pose, for tuning against real recordings. */
export function poseDetail(p: Point[]) {
  const palm = dist(p[WRIST], p[MIDDLE.mcp]) || 1e-6;
  let cx = 0;
  let cy = 0;
  for (const i of TIPS) {
    cx += p[i].x;
    cy += p[i].y;
  }
  const centroid = { x: cx / TIPS.length, y: cy / TIPS.length };
  return {
    index: reach(p, INDEX),
    middle: reach(p, MIDDLE),
    ring: reach(p, RING),
    pinky: reach(p, PINKY),
    thumb: thumbReach(p),
    /** How far the furthest fingertip is from the fingertips' centre, in palm lengths (small = tips together). */
    tipSpread: Math.max(...TIPS.map((i) => dist(p[i], centroid))) / palm,
    /** How far the fingertips' centre is from the wrist, in palm lengths (small = curled into the palm). */
    tipReach: dist(centroid, p[WRIST]) / palm,
    /** Thumb tip to middle fingertip, in palm lengths. */
    thumbMiddle: dist(p[THUMB_TIP], p[MIDDLE.tip]) / palm,
  };
}

// Proposed starting thresholds for the 2026-09-18 gestures; to be tuned on
// real recordings like the open-palm ones above.
/** Pyramid: all five fingertips within this of their centre (palm lengths)… */
const PYRAMID_SPREAD = 0.32;
/** …and held out from the palm, not curled into it. */
const PYRAMID_REACH = 1.3;
/** Fist: every finger curled at least this far. */
const FIST_REACH = 1.0;
/** Snap: thumb and middle fingertip touching… */
const SNAP_TOUCH = 0.35;
/** …then apart by at least this, with the middle finger slammed down. */
const SNAP_APART = 0.6;

export function classifyPose(p: Point[]): Pose {
  const d = poseDetail(p);
  if (d.tipSpread < PYRAMID_SPREAD && d.tipReach > PYRAMID_REACH) return 'pyramid';
  // Snap-ready: thumb on the middle fingertip, middle reaching out to meet it,
  // ring and little finger curled. (Pointing curls the middle finger instead.)
  if (d.thumbMiddle < SNAP_TOUCH && d.middle >= FIST_REACH && d.ring < FOLDED && d.pinky < FOLDED) return 'snapReady';
  if (Math.min(d.index, d.middle, d.ring, d.pinky) > OPEN_EXTENDED) return 'open';
  if (d.index > EXTENDED && d.middle < FOLDED && d.ring < FOLDED && d.pinky < FOLDED) return 'point';
  if (Math.max(d.index, d.middle, d.ring, d.pinky) < FIST_REACH) return 'fist';
  return 'other';
}

/** The moment after a snap: thumb and middle finger apart, middle finger down in the palm. */
export function isSnapped(p: Point[]): boolean {
  const d = poseDetail(p);
  return d.thumbMiddle > SNAP_APART && d.middle < FIST_REACH;
}

/**
 * How open the hand is, 0 (fist) … 1 (open palm), from the four fingers'
 * average reach. Drives the close/open preview so the screen moves with the
 * fingers while they close.
 */
export function openness(p: Point[]): number {
  const d = poseDetail(p);
  const avg = (d.index + d.middle + d.ring + d.pinky) / 4;
  return Math.max(0, Math.min(1, (avg - 0.85) / (1.3 - 0.85)));
}

const PALM = [WRIST, INDEX.mcp, MIDDLE.mcp, RING.mcp, PINKY.mcp];

/** Palm centre (wrist + knuckles): steadier than the fingertips. */
export function palmCenter(p: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const i of PALM) {
    x += p[i].x;
    y += p[i].y;
  }
  return { x: x / PALM.length, y: y / PALM.length };
}

/** Palm length (wrist → middle knuckle), the unit swipe travel is measured in. */
export function palmScale(p: Point[]): number {
  return dist(p[WRIST], p[MIDDLE.mcp]);
}

// The dial follows how the fingertip's direction of travel turns: a circle
// turns it by a full 2π per lap wherever the circle is, a straight move by ~0.
const DIAL_MIN_MOVE = 0.012;
const DIAL_MAX_TURN_PER_SAMPLE = Math.PI / 2;
const DIAL_STEP = Math.PI / 2;

export class DialTracker {
  private last: Point | null = null;
  private heading: number | null = null;
  private accum = 0;

  reset() {
    this.last = null;
    this.heading = null;
    this.accum = 0;
  }

  /** Feed the fingertip; returns whole quarter-turn steps (+ clockwise). */
  update(tip: Point): number {
    if (!this.last) this.last = tip;
    const mx = tip.x - this.last.x;
    const my = tip.y - this.last.y;
    if (Math.hypot(mx, my) < DIAL_MIN_MOVE) return 0;
    // y grows downwards, so an increasing heading turns clockwise on screen.
    const heading = Math.atan2(my, mx);
    if (this.heading !== null) {
      let d = heading - this.heading;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      // A sudden reversal is jitter or a new stroke, not part of a circle.
      if (Math.abs(d) <= DIAL_MAX_TURN_PER_SAMPLE) this.accum += d;
    }
    this.heading = heading;
    this.last = tip;
    const steps = Math.trunc(this.accum / DIAL_STEP);
    this.accum -= steps * DIAL_STEP;
    return steps;
  }
}

/** Head position → window-parallax offsets in -1…1 (0 when centred). */
export function headOffset(face: { x: number; y: number }): { x: number; y: number } {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return { x: clamp((face.x - 0.5) * 3), y: clamp((face.y - 0.45) * 3) };
}
