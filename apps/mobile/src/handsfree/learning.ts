// Per-user gesture learning (user requests, 2026-09-18: the snap "should learn
// … that if that kind of motion is also going to happen it should close", and
// "this learning should not be limited to snap, it should be for swiping up and
// down"). Everything stays on the phone (AsyncStorage); nothing is sent anywhere.
//
// The controller reports every attempt, fired or missed, with its measurements
// (controller.ts, GestureAttempt). The learner adapts the thresholds to how
// this user actually moves:
//
// - Near-miss → retry: an attempt that didn't fire, followed within a few
//   seconds by the same gesture firing, was meant. Its measurements count as
//   this user's style, so the next one like it fires first time.
// - Snap only: a snap the user cancels ("Tap anywhere to stay") wasn't meant,
//   and tightens the snap thresholds past it. (There's no equivalent "undo"
//   signal for scrolling, so swipes and close/open only ever loosen, within
//   their floors.)
//
// Every learned value stays inside fixed bounds, so no amount of learning can
// make a small drift scroll, a slow relax close the app, or a close take
// forever. Pure and deterministic: tested off-device in scripts/gestures-test.ts.

import {
  DEFAULT_SHAPE_TUNING,
  DEFAULT_SNAP_TUNING,
  DEFAULT_SWIPE_TUNING,
  type ControllerTuning,
  type GestureAttempt,
  type SnapAttempt,
  type SnapTuning,
  type SwipeTuning,
} from './controller.ts';

/** Snap: never looser than the floor, never stricter than the ceiling. */
export const SNAP_FLOOR: SnapTuning = { minDelta: 0.15, minRate: 2.5 };
export const SNAP_CEIL: SnapTuning = { minDelta: 0.45, minRate: 7 };
/** Swipe: learning only loosens, and never below this (palm lengths; palm lengths/s). */
export const SWIPE_FLOOR: SwipeTuning = { commitTravel: 0.4, fastTravel: 0.3, fastSpeed: 2 };
/** Close/open: learning only gives more time, up to this. */
export const SHAPE_WINDOW_MAX_MS = 1000;
const SHAPE_WINDOW_STEP_MS = 80;

/** A near-miss this close before the same gesture fired was the same intent. */
const SNAP_SAME_INTENT_MS = 4000;
const SWIPE_SAME_INTENT_MS = 3000;
const SHAPE_SAME_INTENT_MS = 4000;
/** Examples needed before a threshold moves at all. */
const MIN_SNAP_EXAMPLES = 3;
const MIN_SWIPE_EXAMPLES = 2;
const KEEP = 30;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
const finite = (...xs: number[]) => xs.every((x) => Number.isFinite(x));

type SnapSample = { delta: number; rate: number };
type SwipeSample = { travel: number; speed: number };

/** Snap: learns from fired snaps and the near-misses just before them; cancels tighten it. */
export class SnapLearner {
  private positives: SnapSample[] = [];
  private negatives: SnapSample[] = [];
  private pending: (SnapSample & { t: number })[] = [];
  /** The last fired snap and the near-misses promoted with it, so a cancel can undo them. */
  private lastBatch: { fired: SnapSample; promoted: SnapSample[] } | null = null;

  observe(a: Pick<SnapAttempt, 't' | 'fired' | 'delta' | 'rate'>) {
    if (!finite(a.delta, a.rate, a.t)) return;
    const sample = { delta: a.delta, rate: a.rate };
    if (!a.fired) {
      this.pending = this.pending.filter((m) => a.t - m.t <= SNAP_SAME_INTENT_MS);
      this.pending.push({ ...sample, t: a.t });
      return;
    }
    const promoted = this.pending.filter((m) => a.t - m.t <= SNAP_SAME_INTENT_MS).map(({ delta, rate }) => ({ delta, rate }));
    this.pending = [];
    this.positives.push(...promoted, sample);
    this.positives = this.positives.slice(-KEEP);
    this.lastBatch = { fired: sample, promoted };
  }

  /** The user cancelled the last snap: it wasn't meant. */
  cancelLast() {
    const batch = this.lastBatch;
    if (!batch) return;
    this.lastBatch = null;
    const drop = new Set<SnapSample>([batch.fired, ...batch.promoted]);
    this.positives = this.positives.filter((p) => !drop.has(p));
    this.negatives.push(batch.fired);
    this.negatives = this.negatives.slice(-KEEP);
  }

  tuning(): SnapTuning {
    let { minDelta, minRate } = DEFAULT_SNAP_TUNING;
    if (this.positives.length >= MIN_SNAP_EXAMPLES) {
      // Loosen towards this user's own snaps (their weaker ones, with a margin).
      minDelta = Math.min(minDelta, 0.9 * quantile(this.positives.map((p) => p.delta), 0.2));
      minRate = Math.min(minRate, 0.9 * quantile(this.positives.map((p) => p.rate), 0.2));
    }
    minDelta = clamp(minDelta, SNAP_FLOOR.minDelta, SNAP_CEIL.minDelta);
    minRate = clamp(minRate, SNAP_FLOOR.minRate, SNAP_CEIL.minRate);
    // Tighten just enough that no cancelled snap would pass the split check,
    // on whichever threshold separates it from the user's real snaps better.
    const typicalRate = this.positives.length ? quantile(this.positives.map((p) => p.rate), 0.5) : DEFAULT_SNAP_TUNING.minRate * 2;
    for (const n of this.negatives) {
      if (n.delta < minDelta || n.rate < minRate) continue;
      if (typicalRate > n.rate * 1.2) minRate = clamp(n.rate * 1.1, minRate, SNAP_CEIL.minRate);
      else minDelta = clamp(n.delta + 0.03, minDelta, SNAP_CEIL.minDelta);
    }
    return { minDelta, minRate };
  }

  get positiveCount(): number {
    return this.positives.length;
  }

  toJSON() {
    return { positives: this.positives, negatives: this.negatives };
  }

  load(json: unknown) {
    const ok = (x: unknown): x is SnapSample => !!x && typeof x === 'object' && finite((x as SnapSample).delta, (x as SnapSample).rate);
    const j = (json ?? {}) as { positives?: unknown; negatives?: unknown };
    this.positives = (Array.isArray(j.positives) ? j.positives.filter(ok) : []).slice(-KEEP);
    this.negatives = (Array.isArray(j.negatives) ? j.negatives.filter(ok) : []).slice(-KEEP);
  }
}

/** Swipes: learns how far and how fast this user really moves when they mean it. */
class SwipeLearner {
  private examples: SwipeSample[] = [];
  private pending: (SwipeSample & { t: number; direction: string })[] = [];

  observe(a: Extract<GestureAttempt, { kind: 'swipe' }>) {
    if (!finite(a.travel, a.speed, a.t)) return;
    if (!a.fired) {
      this.pending = this.pending.filter((m) => a.t - m.t <= SWIPE_SAME_INTENT_MS);
      this.pending.push({ t: a.t, direction: a.direction, travel: a.travel, speed: a.speed });
      return;
    }
    // Near-misses in the same direction just before a swipe that fired were meant.
    const meant = this.pending.filter((m) => m.direction === a.direction && a.t - m.t <= SWIPE_SAME_INTENT_MS);
    this.pending = [];
    this.examples.push(...meant.map(({ travel, speed }) => ({ travel, speed })));
    this.examples = this.examples.slice(-KEEP);
  }

  tuning(): SwipeTuning {
    const d = DEFAULT_SWIPE_TUNING;
    if (this.examples.length < MIN_SWIPE_EXAMPLES) return { ...d };
    // Commit a little before this user's shorter intended sweeps end.
    const commitTravel = clamp(0.95 * quantile(this.examples.map((e) => e.travel), 0.2), SWIPE_FLOOR.commitTravel, d.commitTravel);
    const fastTravel = clamp(Math.min(d.fastTravel, commitTravel * 0.7), SWIPE_FLOOR.fastTravel, d.fastTravel);
    const fastSpeed = clamp(0.9 * quantile(this.examples.map((e) => e.speed), 0.2), SWIPE_FLOOR.fastSpeed, d.fastSpeed);
    return { commitTravel, fastTravel, fastSpeed };
  }

  get count(): number {
    return this.examples.length;
  }

  toJSON() {
    return { examples: this.examples };
  }

  load(json: unknown) {
    const ok = (x: unknown): x is SwipeSample => !!x && typeof x === 'object' && finite((x as SwipeSample).travel, (x as SwipeSample).speed);
    const j = (json ?? {}) as { examples?: unknown };
    this.examples = (Array.isArray(j.examples) ? j.examples.filter(ok) : []).slice(-KEEP);
  }
}

/** Close (grab) or open (release): learns to allow a slower hand, a step at a time. */
class ShapeWindowLearner {
  private extra = 0;
  private pending: number[] = [];
  private readonly base: number;

  constructor(base: number) {
    this.base = base;
  }

  observe(a: { t: number; fired: boolean }) {
    if (!Number.isFinite(a.t)) return;
    if (!a.fired) {
      this.pending = this.pending.filter((t) => a.t - t <= SHAPE_SAME_INTENT_MS);
      this.pending.push(a.t);
      return;
    }
    const meant = this.pending.filter((t) => a.t - t <= SHAPE_SAME_INTENT_MS).length;
    this.pending = [];
    this.extra = Math.min(SHAPE_WINDOW_MAX_MS - this.base, this.extra + meant * SHAPE_WINDOW_STEP_MS);
  }

  windowMs(): number {
    return this.base + this.extra;
  }

  toJSON() {
    return { extra: this.extra };
  }

  load(json: unknown) {
    const extra = (json as { extra?: unknown } | null)?.extra;
    this.extra = typeof extra === 'number' && Number.isFinite(extra) ? clamp(extra, 0, SHAPE_WINDOW_MAX_MS - this.base) : 0;
  }
}

/** All of it together: what the provider keeps, saves, and feeds the controller. */
export class GestureLearner {
  readonly snap = new SnapLearner();
  private readonly swipe = new SwipeLearner();
  private readonly grab = new ShapeWindowLearner(DEFAULT_SHAPE_TUNING.grabWindowMs);
  private readonly release = new ShapeWindowLearner(DEFAULT_SHAPE_TUNING.releaseWindowMs);

  observe(a: GestureAttempt) {
    if (a.kind === 'snap') this.snap.observe(a);
    else if (a.kind === 'swipe') this.swipe.observe(a);
    else if (a.kind === 'grab') this.grab.observe(a);
    else this.release.observe(a);
  }

  /** The user cancelled the last snap-to-close. */
  cancelLastSnap() {
    this.snap.cancelLast();
  }

  tuning(): ControllerTuning {
    return {
      snap: this.snap.tuning(),
      swipe: this.swipe.tuning(),
      shape: { grabWindowMs: this.grab.windowMs(), releaseWindowMs: this.release.windowMs() },
    };
  }

  /** Examples learned so far, for diagnostics. */
  get examples() {
    return { snap: this.snap.positiveCount, swipe: this.swipe.count };
  }

  toJSON() {
    return { v: 2, snap: this.snap, swipe: this.swipe, grab: this.grab, release: this.release };
  }

  /** Restores saved learning; anything malformed is ignored. */
  static from(json: unknown): GestureLearner {
    const l = new GestureLearner();
    if (!json || typeof json !== 'object') return l;
    const j = json as { v?: number; snap?: unknown; swipe?: unknown; grab?: unknown; release?: unknown };
    if (j.v === 2) {
      l.snap.load(j.snap);
      l.swipe.load(j.swipe);
      l.grab.load(j.grab);
      l.release.load(j.release);
    }
    return l;
  }
}
