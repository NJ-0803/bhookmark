// Hands-free gesture recognition over MediaPipe's 21 hand landmarks.
// Pure functions + a small stateful recogniser, so it can be tested off-device.
//
// Coordinates are normalised 0–1 in a mirrored, upright image: x grows to the
// user's right as they face the screen, y grows downwards.
//
// Gestures (user decisions):
// - Air swipe (2026-09-18, replacing the 2026-09-17 two-finger swipe, which was
//   hard to hold in mid-air): an open palm, all four fingers up (the thumb is
//   ignored; its reading is the noisiest). Up/down scrolls, left/right moves
//   between dishes. Any other hand shape never swipes.
// - Rating dial: a single pointing index finger drawing a circle, like BMW's
//   volume gesture. Clockwise raises, anticlockwise lowers, one step per
//   quarter turn.

export type Point = { x: number; y: number };
export type SwipeDirection = 'left' | 'right' | 'up' | 'down';
export type Pose = 'open' | 'point' | 'other';
export type GestureEvent =
  | { type: 'swipe'; direction: SwipeDirection }
  | { type: 'dial'; steps: number };

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX = { mcp: 5, pip: 6, tip: 8 };
const MIDDLE = { mcp: 9, pip: 10, tip: 12 };
const RING = { mcp: 13, pip: 14, tip: 16 };
const PINKY = { mcp: 17, pip: 18, tip: 20 };

export function toPoints(flat: number[]): Point[] | null {
  if (flat.length !== 42) return null;
  const pts: Point[] = [];
  for (let i = 0; i < 42; i += 2) pts.push({ x: flat[i], y: flat[i + 1] });
  return pts;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

type Finger = { mcp: number; pip: number; tip: number };

/** How far each fingertip reaches from the wrist, relative to its middle joint. */
function reach(p: Point[], f: Finger): number {
  return dist(p[WRIST], p[f.tip]) / dist(p[WRIST], p[f.pip]);
}

/** Thumb tip's distance to the palm (middle/ring knuckles, index middle joint), relative to palm size. */
function thumbReach(p: Point[]): number {
  const palm = dist(p[WRIST], p[MIDDLE.mcp]);
  const near = Math.min(dist(p[THUMB_TIP], p[MIDDLE.mcp]), dist(p[THUMB_TIP], p[RING.mcp]), dist(p[THUMB_TIP], p[INDEX.pip]));
  return near / palm;
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
  return {
    index: reach(p, INDEX),
    middle: reach(p, MIDDLE),
    ring: reach(p, RING),
    pinky: reach(p, PINKY),
    thumb: thumbReach(p),
  };
}

export function classifyPose(p: Point[]): Pose {
  const d = poseDetail(p);
  const index = d.index > EXTENDED;
  if (Math.min(d.index, d.middle, d.ring, d.pinky) > OPEN_EXTENDED) return 'open';
  if (index && d.middle < FOLDED && d.ring < FOLDED && d.pinky < FOLDED) return 'point';
  return 'other';
}

const SWIPE_WINDOW_MS = 550;
// Minimum travel, as a fraction of the frame's width. The upright frame is 3:4
// (320×240 rotated), so vertical travel is scaled by 4/3 to the same units.
const SWIPE_MIN_TRAVEL = 0.22;
const FRAME_HEIGHT_PER_WIDTH = 4 / 3;
// The cross axis must stay under this share of the main axis.
const SWIPE_MAX_CROSS = 0.6;
const SWIPE_COOLDOWN_MS = 800;
// Bringing the hand back after a swipe is not a swipe the other way.
const RETURN_IGNORE_MS = 1000;
// One blurred or misread frame mid-sweep doesn't cancel it; two in a row do.
const SWIPE_MAX_GAP_FRAMES = 1;
const POSE_HOLD_FRAMES = 2;
// A hand rising into view reads as an upward sweep (seen in real recordings),
// so a hand's movement only counts once it has been in view this long.
const ARM_MS = 300;
const OPPOSITE: Record<SwipeDirection, SwipeDirection> = { left: 'right', right: 'left', up: 'down', down: 'up' };
// The dial follows how the fingertip's direction of travel turns: a circle
// turns it by a full 2π per lap wherever the circle is, a straight move by ~0.
const DIAL_MIN_MOVE = 0.012;
const DIAL_MAX_TURN_PER_SAMPLE = Math.PI / 2;
const DIAL_STEP = Math.PI / 2;

export class GestureRecognizer {
  private pose: Pose = 'other';
  private candidate: Pose = 'other';
  private candidateFrames = 0;
  private swipeTrail: { t: number; x: number; y: number }[] = [];
  private swipeGap = 0;
  private handSince: number | null = null;
  private missing = 0;
  private lastSwipeAt = -Infinity;
  private lastSwipeDir: SwipeDirection | null = null;
  private dialLast: Point | null = null;
  private dialHeading: number | null = null;
  private dialAccum = 0;

  /** Current stable pose (after hysteresis). */
  get currentPose(): Pose {
    return this.pose;
  }

  reset() {
    this.pose = 'other';
    this.candidate = 'other';
    this.candidateFrames = 0;
    this.swipeTrail = [];
    this.swipeGap = 0;
    this.handSince = null;
    this.missing = 0;
    this.resetDial();
  }

  private resetDial() {
    this.dialLast = null;
    this.dialHeading = null;
    this.dialAccum = 0;
  }

  /** Feed one frame; `hand` is null when no hand is visible. */
  update(t: number, hand: number[] | null | undefined): GestureEvent[] {
    const pts = hand ? toPoints(hand) : null;
    const seen: Pose = pts ? classifyPose(pts) : 'other';

    if (seen === this.candidate) this.candidateFrames++;
    else {
      this.candidate = seen;
      this.candidateFrames = 1;
    }
    const next = this.candidateFrames >= POSE_HOLD_FRAMES ? this.candidate : this.pose;
    if (next !== this.pose) {
      this.pose = next;
      // Any settled change of hand shape cancels a gesture in progress. Settling
      // into an open palm keeps the frames seen while it settled: the sweep has
      // usually started by then.
      if (next !== 'open') this.swipeTrail = [];
      this.resetDial();
    }
    if (seen === 'open') this.swipeGap = 0;
    else if (++this.swipeGap > SWIPE_MAX_GAP_FRAMES) this.swipeTrail = [];
    if (seen !== 'point') this.resetDial();

    const events: GestureEvent[] = [];
    if (!pts) {
      if (++this.missing > SWIPE_MAX_GAP_FRAMES) this.handSince = null;
      return events;
    }
    this.missing = 0;
    if (this.handSince === null) this.handSince = t;

    if (seen === 'open' && t - this.handSince >= ARM_MS) {
      // Track the palm centre (wrist + knuckles): steadier than the fingertips.
      const palm = [WRIST, INDEX.mcp, MIDDLE.mcp, RING.mcp, PINKY.mcp];
      const x = palm.reduce((a, i) => a + pts[i].x, 0) / palm.length;
      const y = (palm.reduce((a, i) => a + pts[i].y, 0) / palm.length) * FRAME_HEIGHT_PER_WIDTH;
      this.swipeTrail.push({ t, x, y });
      this.swipeTrail = this.swipeTrail.filter((s) => t - s.t <= SWIPE_WINDOW_MS);
      const first = this.swipeTrail[0];
      const dx = x - first.x;
      const dy = y - first.y;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const main = horizontal ? Math.abs(dx) : Math.abs(dy);
      const cross = horizontal ? Math.abs(dy) : Math.abs(dx);
      const direction: SwipeDirection = horizontal ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      const since = t - this.lastSwipeAt;
      const isReturn = this.lastSwipeDir !== null && direction === OPPOSITE[this.lastSwipeDir] && since < RETURN_IGNORE_MS;
      // Fires only once the open palm has settled (the pose hold), but counts the travel from its first frame.
      const settled = this.pose === 'open';
      if (settled && since > SWIPE_COOLDOWN_MS && !isReturn && main >= SWIPE_MIN_TRAVEL && cross < main * SWIPE_MAX_CROSS) {
        events.push({ type: 'swipe', direction });
        this.lastSwipeAt = t;
        this.lastSwipeDir = direction;
        this.swipeTrail = [];
      }
    }

    if (this.pose === 'point' && seen === 'point') {
      const tip = pts[INDEX.tip];
      if (!this.dialLast) this.dialLast = tip;
      const mx = tip.x - this.dialLast.x;
      const my = tip.y - this.dialLast.y;
      if (Math.hypot(mx, my) >= DIAL_MIN_MOVE) {
        // y grows downwards, so an increasing heading turns clockwise on screen.
        const heading = Math.atan2(my, mx);
        if (this.dialHeading !== null) {
          let d = heading - this.dialHeading;
          if (d > Math.PI) d -= 2 * Math.PI;
          if (d < -Math.PI) d += 2 * Math.PI;
          // A sudden reversal is jitter or a new stroke, not part of a circle.
          if (Math.abs(d) <= DIAL_MAX_TURN_PER_SAMPLE) this.dialAccum += d;
        }
        this.dialHeading = heading;
        this.dialLast = tip;
        const steps = Math.trunc(this.dialAccum / DIAL_STEP);
        if (steps !== 0) {
          this.dialAccum -= steps * DIAL_STEP;
          events.push({ type: 'dial', steps });
        }
      }
    }
    return events;
  }
}

/** Head position → window-parallax offsets in -1…1 (0 when centred). */
export function headOffset(face: { x: number; y: number }): { x: number; y: number } {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return { x: clamp((face.x - 0.5) * 3), y: clamp((face.y - 0.45) * 3) };
}
