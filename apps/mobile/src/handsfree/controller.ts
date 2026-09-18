// Hands-free controller: turns landmark samples into a small, deliberate state
// machine, separating a reversible visual PREVIEW from a COMMITTED action.
// Only a commit may navigate or change data; the preview just lets the screen
// follow the hand from the moment its direction is clear.
//
//   searching → candidate → armed → previewing → (commit) → rearm → armed …   (left/right)
//                                        ↘ (reversal / too slow) → rearm (settle first)
//                             armed → following ⇄ armed                      (up/down)
//   Up/down doesn't swipe: while `following`, the list moves with the hand,
//   smoothed, a sample at a time (`scroll` events), and stops when it stops.
//   A stable pointing finger switches to `dial` instead.
//   Shape gestures (2026-09-18), each committed exactly once:
//     armed (open, still) → closing → fist: `grab` (list moves down with the fingers)
//     fist held still → opening → open: `release` (list moves up)
//     pyramid held → open: `bloom` (open the highlighted dish)
//     snap-ready held → snapped: `snap` (close the app)
//
// All timing uses the samples' capture time (camera clock, ms) and elapsed-time
// tolerances, so behaviour is the same at 10, 18 or 30 frames a second. Travel
// is measured in palm lengths, so a near hand and a far hand need the same
// gesture. Pure and deterministic: tested off-device in scripts/gestures-test.ts.

import {
  classifyPose,
  DialTracker,
  INDEX,
  isSnapped,
  openness,
  poseDetail,
  palmCenter,
  palmScale,
  OneEuro,
  toPoints,
  type GestureEvent,
  type Point,
  type Pose,
  type SwipeDirection,
} from './gestures.ts';

export type ControllerState =
  | 'searching'
  | 'candidate'
  | 'armed'
  | 'previewing'
  | 'following'
  | 'rearm'
  | 'dial'
  | 'closing'
  | 'fist'
  | 'opening'
  | 'pyramid'
  | 'snap';
export type Preview = { axis: 'x' | 'y'; direction: SwipeDirection; progress: number } | null;
export type Sample = { t: number; w: number; h: number; hand: readonly number[] | null | undefined };
/**
 * One gesture attempt, fired or missed, with the measurements the per-user
 * learner (learning.ts) adapts from. Reported on the sample where it resolved.
 * - snap: how far (palm lengths) and how fast (palm lengths/s) thumb and middle came apart.
 * - swipe: the furthest travel (palm lengths) and peak speed (palm lengths/s) along its direction.
 * - grab / release: how long the close or open took (ms).
 */
export type GestureAttempt =
  | { kind: 'snap'; t: number; fired: boolean; delta: number; rate: number }
  | { kind: 'swipe'; t: number; fired: boolean; direction: SwipeDirection; travel: number; speed: number }
  | { kind: 'grab' | 'release'; t: number; fired: boolean; ms: number };
export type SnapAttempt = Extract<GestureAttempt, { kind: 'snap' }>;
/** The two snap thresholds the learner adjusts. */
export type SnapTuning = { minDelta: number; minRate: number };
export const DEFAULT_SNAP_TUNING: SnapTuning = { minDelta: 0.25, minRate: 3.5 };
/** Swipe commit distances (palm lengths) and the flick speed (palm lengths/s). */
export type SwipeTuning = { commitTravel: number; fastTravel: number; fastSpeed: number };
export const DEFAULT_SWIPE_TUNING: SwipeTuning = { commitTravel: 0.66, fastTravel: 0.45, fastSpeed: 3 };
/** How long a close (grab) or open (release) may take. */
export type ShapeTuning = { grabWindowMs: number; releaseWindowMs: number };
export const DEFAULT_SHAPE_TUNING: ShapeTuning = { grabWindowMs: 600, releaseWindowMs: 600 };
export type ControllerTuning = { snap: SnapTuning; swipe: SwipeTuning; shape: ShapeTuning };
export const DEFAULT_TUNING: ControllerTuning = { snap: DEFAULT_SNAP_TUNING, swipe: DEFAULT_SWIPE_TUNING, shape: DEFAULT_SHAPE_TUNING };
export type ControllerOutput = {
  state: ControllerState;
  pose: Pose | 'none';
  preview: Preview;
  events: GestureEvent[];
  /** Set on the sample where a gesture attempt resolved (fired or missed). */
  attempt?: GestureAttempt;
};

// Baseline values carried over from the frame-based recogniser (tuned on real
// Pixel 4a recordings), expressed in time and palm lengths.
/** An open palm must be held this long before it can swipe (a hand rising into view reads as "up"). */
export const ARM_MS = 300;
/**
 * A missing or misread stretch shorter than the gap tolerance doesn't break a
 * pose. The tolerance follows the measured frame cadence: 3× the median recent
 * interval, or 1.5× the 90th percentile when frames come in bursts (recording
 * rec9, 2026-09-18: runs 33 ms apart with regular 166 ms holes — the median
 * alone gave 120 ms, and every hole reset the hand), kept within these bounds. (On the Pixel 4a, frames with a hand in
 * view regularly arrive 130–200 ms apart; a fixed 120 ms kept resetting
 * gestures mid-way — recordings, 2026-09-18.)
 */
const GAP_MIN_MS = 120;
const GAP_MAX_MS = 250;
/**
 * Swipes work from any steady hand shape (user decision, 2026-09-18: "palm,
 * fist, 2 fingers, 1 finger, everything"), except the set-ups that belong to
 * other gestures (pyramid, snap), and a pointing finger while a rating dial is
 * on screen.
 */
/** Right after a swipe, a fast flick (this speed or more, palm lengths/s) may swipe again; a slower return of the hand doesn't. */
const FLICK_SPEED = 2.8;
/** …but not sooner than this after the last swipe. */
const FLICK_MIN_MS = 150;
/** A pointing finger must hold this long before the dial listens. */
const POINT_DWELL_MS = 110;
/**
 * Once dialling, the dial keeps following the fingertip through samples that
 * misread the pose (a finger pointing at the camera reads short, as a fist;
 * blur mangles the other fingers into "other" or snap-ready) or lose the hand,
 * for this long after the last clean pointing sample. An open palm ends it at
 * once. Recording rec13 (2026-09-18): only 99 of 250 samples while circling
 * read as pointing, and the dial counted 5 of ~19 quarter turns.
 */
const DIAL_GRACE_MS = 700;
/** Loose pointing on the rating screen: index reach (palm lengths) above this, and above every other finger. */
const DIAL_POINT_REACH = 1.05;
/** Motion older than this doesn't count towards a swipe. */
const WINDOW_MS = 550;
/** Preview starts once the hand has moved this far (palm lengths) in one clear direction. */
const PREVIEW_MIN = 0.15;
// Swipe commit distance: DEFAULT_SWIPE_TUNING (0.66 palm ≈ the old 22% of frame
// width at a typical distance; a fast flick commits at 0.45), adapted per user.
/** An abandoned sweep shorter than this isn't reported as an attempt (palm lengths). */
const SWIPE_ATTEMPT_TRAVEL = 0.25;
/** Never commit on less than this absolute travel (frame widths): far hands are noisy. */
const MIN_ABS_TRAVEL = 0.08;
/** The cross axis must stay under this share of the main axis. */
const MAX_CROSS = 0.6;
/**
 * A sweep must commit within this of its preview starting. Timed from the
 * preview, not from the oldest motion sample: after a long "Ready" hold that
 * sample is already ~WINDOW_MS old, which cancelled real up-swipes one frame
 * into their preview (recording, 2026-09-18).
 */
const PREVIEW_MAX_MS = 600;
/** Pulling back this far (palm lengths) from the furthest point cancels a preview. */
const CANCEL_REVERSAL = 0.2;
/** After a commit: a minimum lockout, then the hand must settle (or leave, or change shape). */
const REARM_MIN_MS = 250;
const STILL_SPEED = 0.8; // palm lengths per second
const STILL_MS = 120;
const REARM_MAX_MS = 1500;
/** Arming also needs the palm roughly still: a hand still moving into place can't arm. */
const ARM_STILL_SPEED = 1.2; // palm lengths per second
// Shape gestures: proposed starting values, to be tuned on real recordings.
// Closing a held open palm must reach a fist, and opening a held fist must
// reach an open palm, within DEFAULT_SHAPE_TUNING's windows (adapted per user).
/**
 * Up/down follows the hand (user request, 2026-09-18: "slow … step by step …
 * it should not jitter but smoothly move"). Values from the recording that
 * prompted it: real up/down moves were 0.35–0.7 palm lengths at 0.3–0.9 palm/s.
 * The list starts following once a Ready hand has moved this far (palm
 * lengths) more up/down than sideways…
 */
const FOLLOW_START = 0.06;
/** …tracking jitter smaller than this (palm lengths) never moves it… */
const FOLLOW_DEADBAND = 0.025;
/** …and after this long still, it's Ready again (a sideways swipe can start). */
const FOLLOW_RELEASE_MS = 700;
const FOLLOW_STILL_SPEED = 0.3; // palm lengths per second
/** One Euro smoothing of the palm's height: ~1 Hz at rest, opening up as the hand moves. */
const FOLLOW_MIN_CUTOFF = 1;
const FOLLOW_BETA = 3;
/**
 * Following starts only on a consistent move: the smoothed height has gone the
 * same way over this many consecutive samples. A fidgeting hand (eating,
 * talking) wanders back and forth and never starts it.
 */
const FOLLOW_CONSISTENT = 2;
/**
 * …and it must also clear the hand's own noise floor: a running average of
 * how jerky its height is sample to sample (second difference, palm lengths),
 * measured while it isn't following. A steady move has almost none, so real
 * moves start as soon as ever; a fidgeting hand raises the bar above its wander.
 */
const FOLLOW_NOISE_K = 1;
const FOLLOW_NOISE_ALPHA = 0.25;
/**
 * Coaching (2026-09-18): the camera loses a hand that moves fast (at ~15
 * samples/s it blurs, or leaves the frame, within 1–3 samples — recording rec8:
 * every up/down move above ~2 palm lengths/s was lost). A Ready hand lost while
 * moving at least this fast (palm lengths/s)…
 */
const TOO_FAST_SPEED = 2;
/** …that comes back into view within this is a gesture that was too fast (a hand lowered away doesn't come back). */
const TOO_FAST_RETURN_MS = 1000;
/**
 * Coaching: a palm (wrist to middle knuckle) this big (frame widths) means the
 * hand is ~15–20 cm from the camera and fills the frame, so any move takes it
 * out of view. At a forearm's length it's ~0.15–0.2. Recordings rec3–rec10
 * (2026-09-18): the user's palm was 0.41–0.48 at the median, and 88–95% of
 * hand frames were within a palm length of an edge.
 */
const TOO_CLOSE_PALM = 0.36;
/** …held that close this long (gap-tolerant) before saying so. */
const TOO_CLOSE_MS = 800;
/** A fist must be held (and still) this long before opening it counts. */
const FIST_ARM_MS = 300;
/** A fingertip pyramid must be held this long… */
const PYRAMID_DWELL_MS = 200;
/** …and open into a palm within this. */
const BLOOM_WINDOW_MS = 600;
/**
 * Snap: thumb on the middle fingertip (one sample is enough — real snaps were
 * set up and fired within 30 ms), then within this window either the middle
 * finger is seen folded into the palm, or thumb and middle finger fly apart
 * fast. On the Pixel 4a most snaps showed only the fast split: the fold happens
 * between camera frames (recordings, 2026-09-18).
 */
const SNAP_WINDOW_MS = 350;
/** A separation smaller than this is a wobble, not an attempt (palm lengths). */
const SNAP_ATTEMPT_DELTA = 0.12;

/** When a pose was first and last seen, tolerating short gaps. */
class Held {
  since: number | null = null;
  last = -Infinity;
  update(t: number, seen: boolean, gap: number) {
    if (seen) {
      if (this.since === null || t - this.last > gap) this.since = t;
      this.last = t;
    } else if (t - this.last > gap) {
      this.since = null;
    }
  }
  heldFor(t: number): number {
    return this.since === null ? 0 : t - this.since;
  }
  clear() {
    this.since = null;
    this.last = -Infinity;
  }
}
/** Palms smaller than this (frame widths) are too far away or a false detection. */
const MIN_PALM = 0.05;
/** A palm jumping further than this between consecutive samples is a tracking glitch. */
const MAX_JUMP = 1.5; // palm lengths

type TrailPoint = { t: number; x: number; y: number };

export class HandsFreeController {
  private state: ControllerState = 'searching';
  private pose: Pose | 'none' = 'none';
  private lastT = -Infinity;
  /** Recent sample intervals (ms), for the adaptive gap tolerance. */
  private intervals: number[] = [];
  private gap = GAP_MIN_MS;
  private lastHandAt = -Infinity;
  /** The last sample in which the camera reported no (usable) hand. */
  private lastNoHandAt = -Infinity;
  /** When a swipe-capable hand shape was first and last seen (gap-tolerant). */
  private steadySince: number | null = null;
  private lastSteadyAt = -Infinity;
  /** When an open palm was last seen (a grab starts from one). */
  private lastOpenAt = -Infinity;
  /** Consecutive open-palm samples (two end a dial). */
  private openRun = 0;
  /** A rating dial is on screen: a pointing finger dials instead of swiping. */
  private dialEnabled = false;
  private pointSince: number | null = null;
  private lastPointAt = -Infinity;
  private scale = 0;
  private trail: TrailPoint[] = [];
  private preview: { dir: SwipeDirection; origin: TrailPoint; startedAt: number; furthest: number; peakSpeed: number } | null = null;
  private lastCommitAt = -Infinity;
  /** Direction of the last swipe (or abandoned sweep); a flick must go another way. Null after other gestures. */
  private lastSwipeDir: SwipeDirection | null = null;
  /** Rearm can't complete before this time (a lockout after commits, none after a cancel). */
  private rearmNotBefore = -Infinity;
  private stillSince: number | null = null;
  private dial = new DialTracker();
  private fist = new Held();
  private pyramid = new Held();
  private snapReady = new Held();
  /** Palm centres of every recent sample, whatever the pose (for stillness and glitch checks). */
  private recent: TrailPoint[] = [];
  private closingFrom = -Infinity;
  private tuning: ControllerTuning = DEFAULT_TUNING;
  private openingFrom = -Infinity;
  /** The last thumb-on-middle sample: when, and how close. */
  private snapTouch: { t: number; tm: number } | null = null;
  /**
   * A separation that didn't fire. Only reported once the set-up ends without
   * the thumb going back on the middle finger: a thumb wobbling while the
   * set-up is held is not an attempt (recording, 2026-09-18: six wobbles in a
   * 2-second hold were being learned as snaps).
   */
  private snapMiss: SnapAttempt | null = null;
  /** Consecutive thumb-on-middle samples, and the previous hand sample's measurements. */
  private snapReadyRun = 0;
  private prevDetail: ReturnType<typeof poseDetail> | null = null;
  private attempt: GestureAttempt | undefined;
  /** Close/open preview: the list moves with the fingers. */
  private shapePreview: { dir: SwipeDirection; progress: number } | null = null;
  /** Hand-follow: the palm's smoothed height (palm lengths at the scale it armed with). */
  private followFilter = new OneEuro(FOLLOW_MIN_CUTOFF, FOLLOW_BETA);
  private followScale = 0;
  private followY: number | null = null;
  /** Where the hand armed (following starts once it leaves here), and how far the list has been told to move. */
  private followAnchor: number | null = null;
  private followSent = 0;
  private followStillSince: number | null = null;
  /** The last few smoothed heights (before the dead band), for the consistency check. */
  private followHistory: number[] = [];
  /** The hand's height noise (see FOLLOW_NOISE_K), and the last two raw heights it's measured from. */
  private followNoise = 0;
  private noiseYs: number[] = [];
  /** A Ready hand was lost mid-fast-move at this time; if it comes back soon, coach the user to move slower. */
  private lostFastAt: number | null = null;
  /** When the hand was first seen too close (see TOO_CLOSE_PALM), and whether this spell was already coached. */
  private tooClose = new Held();
  private tooCloseSaid = false;

  get currentState(): ControllerState {
    return this.state;
  }

  /** The rating screen turns the pointing-finger dial on; elsewhere one finger swipes. */
  setDialEnabled(on: boolean) {
    this.dialEnabled = on;
    if (!on && this.state === 'dial') {
      this.dial.reset();
      this.state = 'searching';
    }
  }

  /** Thresholds adapted per user by the learner (learning.ts). */
  setTuning(tuning: ControllerTuning) {
    this.tuning = { snap: { ...tuning.snap }, swipe: { ...tuning.swipe }, shape: { ...tuning.shape } };
  }

  /** Full reset: mode off, backgrounded, camera restarted. */
  reset() {
    this.state = 'searching';
    this.pose = 'none';
    this.lastT = -Infinity;
    this.intervals = [];
    this.gap = GAP_MIN_MS;
    this.lastHandAt = -Infinity;
    this.lastNoHandAt = -Infinity;
    this.steadySince = null;
    this.lastSteadyAt = -Infinity;
    this.lastOpenAt = -Infinity;
    this.pointSince = null;
    this.lastPointAt = -Infinity;
    this.scale = 0;
    this.trail = [];
    this.preview = null;
    this.lastCommitAt = -Infinity;
    this.lastSwipeDir = null;
    this.rearmNotBefore = -Infinity;
    this.stillSince = null;
    this.dial.reset();
    this.clearShapes();
    this.recent = [];
    this.resetFollow();
    this.lostFastAt = null;
    this.tooClose.clear();
    this.tooCloseSaid = false;
    this.followNoise = 0;
    this.noiseYs = [];
  }

  /** The next Ready hand starts following from where it is. */
  private resetFollow() {
    this.followFilter.reset();
    this.followScale = 0;
    this.followY = null;
    this.followAnchor = null;
    this.followSent = 0;
    this.followStillSince = null;
    this.followHistory = [];
  }

  /** The palm's height, smoothed, with a small dead band so jitter at rest never moves the list. */
  private trackFollow(t: number, y: number, scale: number): number {
    if (!this.followScale) this.followScale = scale;
    const f = this.followFilter.filter(y / this.followScale, t);
    this.followHistory.push(f);
    if (this.followHistory.length > FOLLOW_CONSISTENT + 1) this.followHistory.shift();
    if (this.followY === null) this.followY = f;
    else if (f - this.followY > FOLLOW_DEADBAND) this.followY = f - FOLLOW_DEADBAND;
    else if (this.followY - f > FOLLOW_DEADBAND) this.followY = f + FOLLOW_DEADBAND;
    return this.followY;
  }

  /** Updates the hand's height noise; frozen while following (the move itself isn't noise). */
  private measureNoise(y: number) {
    this.noiseYs.push(y);
    if (this.noiseYs.length > 3) this.noiseYs.shift();
    if (this.state === 'following' || this.noiseYs.length < 3) return;
    const [a, b, c] = this.noiseYs;
    const jerk = Math.abs(c - 2 * b + a);
    this.followNoise += FOLLOW_NOISE_ALPHA * (jerk - this.followNoise);
  }

  /** The smoothed height moved the same way (sign) over each of the last FOLLOW_CONSISTENT samples. */
  private movingSteadily(sign: number): boolean {
    const h = this.followHistory;
    if (h.length < FOLLOW_CONSISTENT + 1) return false;
    for (let i = 1; i < h.length; i++) if ((h[i] - h[i - 1]) * sign <= 0) return false;
    return true;
  }

  private clearShapes() {
    this.fist.clear();
    this.pyramid.clear();
    this.snapReady.clear();
    this.shapePreview = null;
    this.closingFrom = -Infinity;
    this.snapTouch = null;
    this.snapReadyRun = 0;
    this.prevDetail = null;
  }

  /**
   * Another input (a touch) took over: cancel any preview and require the
   * gesture to start again. Timing gates and rearm state are kept.
   */
  interrupt() {
    // Arming again needs a still, open palm, so the rest of an interrupted
    // sweep can't complete it.
    this.preview = null;
    this.trail = [];
    this.steadySince = null;
    this.pointSince = null;
    this.dial.reset();
    this.clearShapes();
    this.resetFollow();
    this.state = 'searching';
  }

  update(sample: Sample): ControllerOutput {
    const events: GestureEvent[] = [];
    const t = sample.t;
    // Out-of-order or duplicate samples are dropped.
    if (!(t > this.lastT)) return this.output(events);
    if (Number.isFinite(this.lastT)) {
      this.intervals.push(t - this.lastT);
      if (this.intervals.length > 15) this.intervals.shift();
      const sorted = [...this.intervals].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      this.gap = Math.max(GAP_MIN_MS, Math.min(GAP_MAX_MS, Math.max(median * 3, p90 * 1.5)));
    }
    this.lastT = t;
    const GAP_MS = this.gap;

    let pts = toPoints(sample.hand, sample.w > 0 && sample.h > 0 ? sample.h / sample.w : NaN);
    let scale = pts ? palmScale(pts) : 0;
    if (pts && scale < MIN_PALM) pts = null;
    let center: Point | null = pts ? palmCenter(pts) : null;
    // Reject implausible jumps (tracking glitches) against the last sample.
    const prev = this.recent[this.recent.length - 1];
    if (center && prev && t - prev.t < GAP_MS * 2 && Math.hypot(center.x - prev.x, center.y - prev.y) > MAX_JUMP * scale) {
      pts = null;
      center = null;
    }

    if (!pts) {
      this.lastNoHandAt = t;
      this.pose = t - this.lastHandAt > GAP_MS ? 'none' : this.pose;
      if (t - this.lastHandAt > GAP_MS) this.lose(t, true);
      return this.output(events);
    }

    // Samples resuming after a stale gap: treat as a new hand, never continue the old gesture.
    // (Seen gone if the camera reported no hand meanwhile; otherwise samples just stalled.)
    if (t - this.lastHandAt > GAP_MS) this.lose(t, this.lastNoHandAt > this.lastHandAt);
    if (this.lostFastAt !== null) {
      // Back soon after a fast move lost it: that was a gesture, just too fast for the camera.
      if (t - this.lostFastAt <= TOO_FAST_RETURN_MS) events.push({ type: 'hint', hint: 'slower' });
      this.lostFastAt = null;
    }
    this.lastHandAt = t;
    // Too close to the camera for long: coach once per spell.
    this.tooClose.update(t, scale >= TOO_CLOSE_PALM, GAP_MS);
    if (this.tooClose.since === null) this.tooCloseSaid = false;
    else if (!this.tooCloseSaid && this.tooClose.heldFor(t) >= TOO_CLOSE_MS) {
      events.push({ type: 'hint', hint: 'back' });
      this.tooCloseSaid = true;
    }
    this.scale = this.scale ? this.scale * 0.7 + scale * 0.3 : scale;
    scale = this.scale;
    const seen = classifyPose(pts);
    this.pose = seen;
    this.recent.push({ t, x: center!.x, y: center!.y });
    while (this.recent.length > 1 && t - this.recent[0].t > 300) this.recent.shift();
    this.fist.update(t, seen === 'fist', GAP_MS);
    this.pyramid.update(t, seen === 'pyramid', GAP_MS);
    this.snapReady.update(t, seen === 'snapReady', GAP_MS);
    // The rating screen only dials: other shape gestures there would steal
    // samples from the dial (a thumb resting on the curled middle finger while
    // pointing read as a snap set-up), and nothing on it reacts to them.
    const shape = !this.dialEnabled && this.shapes(t, seen, pts, scale, events);
    if (shape) return this.output(events);

    // Pose timing with a short gap tolerance: one misread sample doesn't reset it.
    const swipeable = seen !== 'pyramid' && seen !== 'snapReady' && !(seen === 'point' && this.dialEnabled);
    if (swipeable) {
      if (this.steadySince === null || t - this.lastSteadyAt > GAP_MS) this.steadySince = t;
      this.lastSteadyAt = t;
    } else if (t - this.lastSteadyAt > GAP_MS) {
      this.steadySince = null;
    }
    if (seen === 'open') this.lastOpenAt = t;
    // On the rating screen (nothing else to do there) pointing is read loosely:
    // the index finger out and the most extended finger. Circling turns the
    // finger towards the camera, where it reads short, and blur mangles the
    // other fingers (rec13: loose 125 vs strict 99 of 190 samples).
    let dialPoint = seen === 'point';
    if (this.dialEnabled && !dialPoint && seen !== 'open') {
      const d = poseDetail(pts);
      dialPoint = d.index > DIAL_POINT_REACH && d.index > Math.max(d.middle, d.ring, d.pinky);
    }
    if (dialPoint) {
      if (this.pointSince === null || t - this.lastPointAt > GAP_MS) this.pointSince = t;
      this.lastPointAt = t;
    } else if (t - this.lastPointAt > GAP_MS) {
      this.pointSince = null;
    }

    // Dial: a settled pointing finger, only while a rating dial is on screen;
    // once dialling, it rides through misread samples (DIAL_GRACE_MS).
    const pointing = this.pointSince !== null && t - this.pointSince >= POINT_DWELL_MS && dialPoint;
    // A single "open" sample mid-circle is usually blur; two in a row end the dial.
    this.openRun = seen === 'open' ? this.openRun + 1 : 0;
    const riding = this.state === 'dial' && this.openRun < 2 && t - this.lastPointAt <= DIAL_GRACE_MS;
    if (this.dialEnabled && (pointing || riding)) {
      if (this.state !== 'dial') {
        this.dial.reset();
        this.preview = null;
        this.trail = [];
      }
      this.state = 'dial';
      // Misread samples count too: on real recordings their tips stay close
      // enough to the circle (rec13: 14 steps with them, 9 without).
      const steps = this.dial.update(pts[INDEX.tip]);
      if (steps !== 0) events.push({ type: 'dial', steps });
      return this.output(events);
    }
    if (this.state === 'dial') {
      this.dial.reset();
      this.state = 'searching';
    }

    if (this.steadySince === null) {
      // Hand in view but in a non-swiping shape: a release, which also completes any rearm.
      this.preview = null;
      this.trail = [];
      this.state = 'searching';
      return this.output(events);
    }
    if (!swipeable || !center) {
      // A tolerated misread inside a swipe: hold state, add nothing.
      return this.output(events);
    }

    this.trail.push({ t, x: center.x, y: center.y });
    while (this.trail.length > 1 && t - this.trail[0].t > WINDOW_MS) this.trail.shift();
    this.measureNoise(center.y / scale);

    if (this.state === 'rearm') {
      if (this.flick(t, scale, events)) return this.output(events);
      if (this.rearmed(t, scale)) {
        this.state = 'armed';
        this.trail = [{ t, x: center.x, y: center.y }];
        this.resetFollow();
      }
      return this.output(events);
    }

    if (t - this.steadySince < ARM_MS) {
      this.state = 'candidate';
      return this.output(events);
    }
    if ((this.state === 'searching' || this.state === 'candidate') && Math.hypot(...this.velocity(t)) / scale > ARM_STILL_SPEED) {
      this.state = 'candidate'; // steady long enough, but still moving into place
      return this.output(events);
    }
    if (this.state === 'searching' || this.state === 'candidate') {
      // Freshly armed: movement before this point doesn't count.
      this.state = 'armed';
      this.trail = [{ t, x: center.x, y: center.y }];
      this.resetFollow();
      this.followAnchor = this.trackFollow(t, center.y, scale);
      return this.output(events);
    }

    if (this.state === 'armed' || this.state === 'following') {
      const y = this.trackFollow(t, center.y, scale);
      if (this.followAnchor === null) this.followAnchor = y;
      // A clear sideways sweep (over the recent window) previews a left/right swipe.
      const first = this.trail[0];
      const dx = (center.x - first.x) / scale;
      const dy = (center.y - first.y) / scale;
      if (Math.abs(dx) >= PREVIEW_MIN && Math.abs(dy) < Math.abs(dx) * MAX_CROSS && (this.state === 'armed' || Math.abs(dx) >= 2 * PREVIEW_MIN)) {
        this.preview = { dir: dx > 0 ? 'right' : 'left', origin: first, startedAt: t, furthest: 0, peakSpeed: 0 };
        this.state = 'previewing';
      } else if (this.state === 'armed') {
        // Up/down: once the hand has clearly moved vertically, the list follows it.
        const moved = y - this.followAnchor;
        if (Math.abs(moved) >= Math.max(FOLLOW_START, FOLLOW_NOISE_K * this.followNoise) && Math.abs(dy) >= Math.abs(dx) && this.movingSteadily(Math.sign(moved))) {
          this.state = 'following';
          this.followStillSince = null;
          events.push({ type: 'scroll', palms: y - this.followAnchor });
          this.followSent = y;
        }
        return this.output(events);
      } else {
        if (y !== this.followSent) events.push({ type: 'scroll', palms: y - this.followSent });
        this.followSent = y;
        // Held still for a moment: Ready again, from here.
        if (Math.hypot(...this.velocity(t)) / scale <= FOLLOW_STILL_SPEED) {
          if (this.followStillSince === null) this.followStillSince = t;
          else if (t - this.followStillSince >= FOLLOW_RELEASE_MS) {
            this.state = 'armed';
            this.followAnchor = y;
            this.trail = [{ t, x: center.x, y: center.y }];
          }
        } else {
          this.followStillSince = null;
        }
        return this.output(events);
      }
    }

    if (this.state === 'previewing' && this.preview) {
      const { dir, origin } = this.preview;
      const along = alongAxis(dir, center.x - origin.x, center.y - origin.y);
      const across = alongAxis(perpendicular(dir), center.x - origin.x, center.y - origin.y);
      const travel = along / scale;
      this.preview.furthest = Math.max(this.preview.furthest, travel);
      const speed = this.speedAlong(dir, t) / scale;
      this.preview.peakSpeed = Math.max(this.preview.peakSpeed, speed);
      const straight = Math.abs(across) < Math.abs(along) * MAX_CROSS;
      const { commitTravel, fastTravel, fastSpeed } = this.tuning.swipe;
      const commit =
        straight &&
        Math.abs(along) >= MIN_ABS_TRAVEL &&
        (travel >= commitTravel || (travel >= fastTravel && speed >= fastSpeed));
      if (commit) {
        events.push({ type: 'swipe', direction: dir });
        this.attempt = { kind: 'swipe', t, fired: true, direction: dir, travel, speed: this.preview.peakSpeed };
        this.preview = null;
        this.state = 'rearm';
        this.lastCommitAt = t;
        this.lastSwipeDir = dir;
        this.rearmNotBefore = t + REARM_MIN_MS;
        this.stillSince = null;
        return this.output(events);
      }
      const reversed = travel < this.preview.furthest - CANCEL_REVERSAL;
      const tooSlow = t - this.preview.startedAt > PREVIEW_MAX_MS;
      if (reversed || tooSlow || !straight) {
        // Incomplete sweep: the preview springs back, and the hand must settle
        // before a new sweep, so pulling back can't start one the other way.
        if (this.preview.furthest >= SWIPE_ATTEMPT_TRAVEL) {
          this.attempt = { kind: 'swipe', t, fired: false, direction: dir, travel: this.preview.furthest, speed: this.preview.peakSpeed };
        }
        this.preview = null;
        this.state = 'rearm';
        this.lastCommitAt = t;
        this.lastSwipeDir = dir;
        this.rearmNotBefore = t;
        this.stillSince = null;
      }
    }
    return this.output(events);
  }

  /**
   * Shape gestures (grab, release, bloom, snap). Returns true when the sample
   * was consumed by one of them.
   */
  private shapes(t: number, seen: Pose, pts: Point[], scale: number, events: GestureEvent[]): boolean {
    this.shapePreview = null;
    const still = Math.hypot(...this.velocity(t)) / scale <= ARM_STILL_SPEED;

    // Snap: thumb on middle fingertip, then snapped apart.
    const d = poseDetail(pts);
    const prev = this.prevDetail;
    this.prevDetail = d;
    this.snapReadyRun = seen === 'snapReady' ? this.snapReadyRun + 1 : 0;
    if (seen === 'snapReady') {
      // A real set-up: the touch lasts two samples, or the hand was already in
      // snap shape just before (thumb near the middle finger, ring and little
      // finger folded). A single-sample "touch" out of an open hand is a
      // misread (seen in a recording where the user wasn't snapping).
      const approached = prev !== null && prev.thumbMiddle < 0.6 && prev.ring < 1.05 && prev.pinky < 1.05;
      if (this.snapReadyRun >= 2 || approached) {
        if (this.state !== 'snap') this.enterShape('snap');
        this.snapTouch = { t, tm: d.thumbMiddle };
        this.snapMiss = null; // back on the middle finger: that was a wobble
      }
      return true;
    }
    if (this.state === 'snap' && this.snapTouch) {
      const dt = t - this.snapTouch.t;
      if (dt <= SNAP_WINDOW_MS) {
        const delta = d.thumbMiddle - this.snapTouch.tm;
        const rate = delta / Math.max(dt / 1000, 1e-3);
        const ringDown = d.ring < 1.05 && d.pinky < 1.05;
        const fold = isSnapped(pts);
        const split = ringDown && seen !== 'open' && delta >= this.tuning.snap.minDelta && rate >= this.tuning.snap.minRate;
        if (fold || split) {
          events.push({ type: 'snap' });
          this.attempt = { kind: 'snap', t, fired: true, delta, rate };
          this.snapMiss = null;
          this.afterShape(t);
          return true;
        }
        if (delta >= SNAP_ATTEMPT_DELTA && (!this.snapMiss || delta > this.snapMiss.delta)) {
          // Came apart, but not like a snap (yet): hold it until the set-up ends.
          this.snapMiss = { kind: 'snap', t, fired: false, delta, rate };
        }
        return true;
      }
      this.endSnapSetUp();
    }

    // Bloom: fingertip pyramid, held, then opened.
    if (this.state === 'pyramid') {
      if (seen === 'pyramid') return true;
      if (t - this.pyramid.last <= BLOOM_WINDOW_MS) {
        if (seen === 'open') {
          events.push({ type: 'bloom' });
          this.afterShape(t);
        }
        return true;
      }
      this.state = 'searching';
    }
    if (seen === 'pyramid' && this.pyramid.heldFor(t) >= PYRAMID_DWELL_MS) {
      this.enterShape('pyramid');
      return true;
    }

    // Release: a held, still fist opens into a palm; the list moves up as it opens.
    if (this.state === 'fist' || this.state === 'opening') {
      if (seen === 'fist') {
        if (!still && this.state === 'fist') {
          // A held fist that starts moving is moving the list, not opening.
          this.state = 'armed';
          this.resetFollow();
          return false;
        }
        this.state = 'fist';
        return true;
      }
      if (t - this.fist.last <= this.tuning.shape.releaseWindowMs) {
        if (seen === 'open') {
          events.push({ type: 'release' });
          this.attempt = { kind: 'release', t, fired: true, ms: t - this.fist.last };
          this.afterShape(t);
          return true;
        }
        if (seen !== 'pyramid') {
          if (this.state === 'fist') this.openingFrom = this.fist.last;
          this.state = 'opening';
          this.shapePreview = { dir: 'up', progress: openness(pts) };
          return true;
        }
      }
      // Too slow to open (or turned into something else): report it for the learner.
      if (this.state === 'opening') this.attempt = { kind: 'release', t, fired: false, ms: t - this.openingFrom };
      this.state = 'searching';
    }
    if (seen === 'fist' && this.fist.heldFor(t) >= FIST_ARM_MS && still && this.state !== 'closing') {
      this.enterShape('fist');
      return true;
    }

    // Grab: a Ready (armed, still) open palm closes into a fist; the list moves down with the fingers.
    if (this.state === 'armed' || this.state === 'closing') {
      if (seen === 'open') {
        if (this.state === 'closing') {
          // Opened again before reaching a fist: cancel.
          this.state = 'armed';
          this.trail = [{ t, x: this.recent[this.recent.length - 1].x, y: this.recent[this.recent.length - 1].y }];
          this.resetFollow();
        }
        return false;
      }
      if (seen === 'pyramid') return false;
      // A close starts from an open palm; other steady shapes just swipe.
      if (this.state === 'armed' && t - this.lastOpenAt > this.gap) return false;
      // A misread sample with the fingers still mostly out isn't a close.
      if (this.state === 'armed' && openness(pts) > 0.75) return false;
      if (this.state === 'armed') {
        this.state = 'closing';
        this.closingFrom = this.lastOpenAt;
      }
      if (t - this.closingFrom > this.tuning.shape.grabWindowMs) {
        this.attempt = { kind: 'grab', t, fired: false, ms: t - this.closingFrom };
        this.state = 'searching';
        this.trail = [];
        return true;
      }
      if (seen === 'fist') {
        events.push({ type: 'grab' });
        this.attempt = { kind: 'grab', t, fired: true, ms: t - this.closingFrom };
        this.afterShape(t);
        // Opening this fist again (a release) needs it held first.
        this.fist.since = t;
        return true;
      }
      this.shapePreview = { dir: 'down', progress: 1 - openness(pts) };
      return true;
    }
    return false;
  }

  /** The snap set-up ended without firing: a separation during it was a real near-miss. */
  private endSnapSetUp() {
    if (this.snapMiss) this.attempt = this.snapMiss;
    this.snapMiss = null;
    this.snapTouch = null;
    if (this.state === 'snap') this.state = 'searching';
  }

  private enterShape(state: 'snap' | 'pyramid' | 'fist') {
    this.state = state;
    this.preview = null;
    this.trail = [];
    this.dial.reset();
  }

  /** After a shape commit: nothing else fires until the hand settles or changes shape. */
  private afterShape(t: number) {
    this.state = 'rearm';
    this.lastSwipeDir = null; // no flicks straight after a close/open, bloom or snap
    this.preview = null;
    this.shapePreview = null;
    this.trail = [];
    this.lastCommitAt = t;
    this.rearmNotBefore = t + REARM_MIN_MS;
    this.stillSince = null;
    this.pyramid.clear();
    this.snapReady.clear();
  }

  /**
   * Right after a swipe (or an abandoned one), a fast, straight flick of at
   * least the commit distance swipes again, in any direction. A slower return
   * of the hand doesn't (user decision, 2026-09-18; recorded returns were about
   * half the speed of real swipes).
   */
  private flick(t: number, scale: number, events: GestureEvent[]): boolean {
    const prevDir = this.lastSwipeDir;
    if (!prevDir || t - this.lastCommitAt < FLICK_MIN_MS) return false;
    const since = this.trail.filter((p) => p.t >= this.lastCommitAt);
    // Measure from the turning point: the rest of the previous sweep isn't a flick.
    let turn = 0;
    for (let i = 1; i < since.length; i++) {
      if (alongAxis(prevDir, since[i].x - since[0].x, since[i].y - since[0].y) > alongAxis(prevDir, since[turn].x - since[0].x, since[turn].y - since[0].y)) turn = i;
    }
    const path = since.slice(turn);
    if (path.length < 2) return false;
    const first = path[0];
    const last = path[path.length - 1];
    const dx = (last.x - first.x) / scale;
    const dy = (last.y - first.y) / scale;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const main = horizontal ? Math.abs(dx) : Math.abs(dy);
    const cross = horizontal ? Math.abs(dy) : Math.abs(dx);
    // Up/down follows the hand instead of swiping.
    if (!horizontal) return false;
    const dir: SwipeDirection = dx > 0 ? 'right' : 'left';
    const speed = this.speedAlong(dir, t) / scale;
    if (dir === prevDir) return false;
    if (main * scale < MIN_ABS_TRAVEL || main < this.tuning.swipe.commitTravel || cross >= main * MAX_CROSS || speed < FLICK_SPEED) return false;
    events.push({ type: 'swipe', direction: dir, flick: true });
    this.lastSwipeDir = dir;
    this.attempt = { kind: 'swipe', t, fired: true, direction: dir, travel: main, speed };
    this.lastCommitAt = t;
    this.rearmNotBefore = t + REARM_MIN_MS;
    this.stillSince = null;
    return true;
  }

  /** After a commit or a cancel, the return stroke can't commit: wait for the hand to settle. */
  private rearmed(t: number, scale: number): boolean {
    if (t < this.rearmNotBefore) return false;
    if (t - this.lastCommitAt > REARM_MAX_MS) return true;
    const speed = Math.hypot(...this.velocity(t)) / scale;
    if (speed > STILL_SPEED) {
      this.stillSince = null;
      return false;
    }
    if (this.stillSince === null) this.stillSince = t;
    return t - this.stillSince >= STILL_MS;
  }

  /** Palm velocity (frame widths per second) over roughly the last 100 ms, whatever the pose. */
  private velocity(t: number): [number, number] {
    const last = this.recent[this.recent.length - 1];
    if (!last) return [0, 0];
    let ref = last;
    for (let i = this.recent.length - 2; i >= 0; i--) {
      ref = this.recent[i];
      if (t - ref.t >= 100) break;
    }
    const dt = (last.t - ref.t) / 1000;
    return dt > 0 ? [(last.x - ref.x) / dt, (last.y - ref.y) / dt] : [0, 0];
  }

  private speedAlong(dir: SwipeDirection, t: number): number {
    const [vx, vy] = this.velocity(t);
    return alongAxis(dir, vx, vy);
  }

  /** `seenGone`: the camera reported no hand (not just a stall with no samples at all). */
  private lose(t: number, seenGone = false) {
    // A snap's own speed blurs the hand out of a frame or two (recording,
    // 2026-09-18: a clean snap was lost to a 167 ms blackout right after a
    // 2-second set-up). Within the snap window, keep the set-up waiting.
    const touch = this.snapTouch;
    const snapPending = this.state === 'snap' && touch !== null && t - touch.t <= SNAP_WINDOW_MS;
    const miss = this.snapMiss;
    if (!snapPending) this.endSnapSetUp();
    // A Ready hand lost while moving fast: coach if it comes back (see update).
    const wasReady = this.state === 'armed' || this.state === 'following' || this.state === 'previewing';
    const speed = this.scale ? Math.hypot(...this.velocity(this.lastHandAt)) / this.scale : 0;
    if (seenGone && wasReady && speed >= TOO_FAST_SPEED) this.lostFastAt = this.lastHandAt;
    // Tracking lost or stale: cancel, never extrapolate. Leaving view also
    // counts as releasing after a commit.
    // A dial rides through a short dropout (blur mid-circle); DIAL_GRACE_MS ends it.
    const keepDial = this.state === 'dial' && this.dialEnabled && t - this.lastPointAt <= DIAL_GRACE_MS;
    this.preview = null;
    this.trail = [];
    this.steadySince = null;
    this.clearShapes();
    this.recent = [];
    this.noiseYs = [];
    this.resetFollow();
    if (keepDial) return;
    this.pointSince = null;
    this.dial.reset();
    this.state = 'searching';
    if (snapPending) {
      this.state = 'snap';
      this.snapTouch = touch;
      this.snapMiss = miss;
    }
  }

  private output(events: GestureEvent[]): ControllerOutput {
    let preview: Preview = null;
    if (this.shapePreview) {
      preview = { axis: 'y', direction: this.shapePreview.dir, progress: this.shapePreview.progress };
    } else if (this.state === 'previewing' && this.preview) {
      const last = this.trail[this.trail.length - 1];
      const { dir, origin } = this.preview;
      const travel = last ? alongAxis(dir, last.x - origin.x, last.y - origin.y) / (this.scale || 1) : 0;
      preview = {
        axis: dir === 'left' || dir === 'right' ? 'x' : 'y',
        direction: dir,
        progress: Math.max(0, Math.min(1, travel / this.tuning.swipe.commitTravel)),
      };
    }
    const attempt = this.attempt;
    this.attempt = undefined;
    return { state: this.state, pose: this.pose, preview, events, attempt };
  }
}

/** Component of (x, y) along a swipe direction (positive = that way). */
function alongAxis(dir: SwipeDirection, x: number, y: number): number {
  switch (dir) {
    case 'right':
      return x;
    case 'left':
      return -x;
    case 'down':
      return y;
    case 'up':
      return -y;
  }
}

function perpendicular(dir: SwipeDirection): SwipeDirection {
  return dir === 'left' || dir === 'right' ? 'down' : 'right';
}
