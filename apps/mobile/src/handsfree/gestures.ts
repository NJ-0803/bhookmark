// Hands-free gesture recognition over MediaPipe's 21 hand landmarks.
// Pure functions + a small stateful recogniser, so it can be tested off-device.
//
// Coordinates are normalised 0–1 in a mirrored, upright image: x grows to the
// user's right as they face the screen, y grows downwards.
//
// Gestures (user decisions, 2026-09-17):
// - Air swipe: ONLY index + middle extended, ring + little + thumb folded.
//   Any other hand shape never swipes, and breaking the pose mid-move cancels.
// - Rating dial: a single pointing index finger drawing a circle, like BMW's
//   volume gesture. Clockwise raises, anticlockwise lowers, one step per
//   quarter turn.

export type Point = { x: number; y: number };
export type Pose = 'two' | 'point' | 'other';
export type GestureEvent =
  | { type: 'swipe'; direction: 'left' | 'right' }
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

/** Extended: the tip is clearly farther from the wrist than the middle joint. */
function extended(p: Point[], f: Finger): boolean {
  return dist(p[WRIST], p[f.tip]) > dist(p[WRIST], p[f.pip]) * 1.25;
}

/** Folded: the tip has curled back to (or inside) the middle joint's reach. */
function folded(p: Point[], f: Finger): boolean {
  return dist(p[WRIST], p[f.tip]) < dist(p[WRIST], p[f.pip]) * 1.05;
}

/** Thumb tucked: its tip sits near the palm (middle/ring knuckles). */
function thumbFolded(p: Point[]): boolean {
  const palm = dist(p[WRIST], p[MIDDLE.mcp]);
  const near = Math.min(dist(p[THUMB_TIP], p[MIDDLE.mcp]), dist(p[THUMB_TIP], p[RING.mcp]), dist(p[THUMB_TIP], p[INDEX.pip]));
  return near < palm * 0.75;
}

export function classifyPose(p: Point[]): Pose {
  const index = extended(p, INDEX);
  const middle = extended(p, MIDDLE);
  const ringDown = folded(p, RING);
  const pinkyDown = folded(p, PINKY);
  if (index && middle && ringDown && pinkyDown && thumbFolded(p)) return 'two';
  if (index && folded(p, MIDDLE) && ringDown && pinkyDown) return 'point';
  return 'other';
}

const SWIPE_WINDOW_MS = 550;
const SWIPE_MIN_DX = 0.22;
const SWIPE_COOLDOWN_MS = 800;
const POSE_HOLD_FRAMES = 2;
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
  private lastSwipeAt = -Infinity;
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
      // Any change of hand shape cancels a gesture in progress.
      this.swipeTrail = [];
      this.resetDial();
    }
    // A single off-pose frame also breaks a swipe: another finger was seen.
    if (seen !== 'two') this.swipeTrail = [];
    if (seen !== 'point') this.resetDial();

    const events: GestureEvent[] = [];
    if (!pts) return events;

    if (this.pose === 'two' && seen === 'two') {
      const x = (pts[INDEX.tip].x + pts[MIDDLE.tip].x) / 2;
      const y = (pts[INDEX.tip].y + pts[MIDDLE.tip].y) / 2;
      this.swipeTrail.push({ t, x, y });
      this.swipeTrail = this.swipeTrail.filter((s) => t - s.t <= SWIPE_WINDOW_MS);
      const first = this.swipeTrail[0];
      const dx = x - first.x;
      const dy = y - first.y;
      if (t - this.lastSwipeAt > SWIPE_COOLDOWN_MS && Math.abs(dx) >= SWIPE_MIN_DX && Math.abs(dy) < Math.abs(dx) * 0.6) {
        events.push({ type: 'swipe', direction: dx > 0 ? 'right' : 'left' });
        this.lastSwipeAt = t;
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
