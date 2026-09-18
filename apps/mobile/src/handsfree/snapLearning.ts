// Per-user snap learning (user request, 2026-09-18: "it should learn … that if
// that kind of motion is also going to happen it should close").
//
// The controller recognises a snap when thumb and middle finger come apart far
// and fast enough (the "split" check; a seen fold always counts). People snap
// differently, so the two split thresholds adapt to this user:
//
// - A snap that closes the app, and isn't cancelled, is a positive example.
// - Near-misses (they came apart, but not enough) followed within a few seconds
//   by a snap that did fire are treated as the same intent: positives too.
//   That's how a style the default rule misses gets learned.
// - A snap the user cancels ("Tap anywhere to stay") is a negative example, and
//   the near-misses that led up to it are dropped.
//
// The learned values are kept inside fixed bounds, so no amount of learning can
// make a slow relax or a small wobble close the app. Everything stays on the
// phone (AsyncStorage); nothing is sent anywhere. Pure and deterministic:
// tested off-device in scripts/gestures-test.ts.

import { DEFAULT_SNAP_TUNING, type SnapAttempt, type SnapTuning } from './controller.ts';

type Sample = { delta: number; rate: number };

/** Never looser than this, whatever was learned. */
export const SNAP_FLOOR: SnapTuning = { minDelta: 0.15, minRate: 2.5 };
/** Never stricter than this, whatever was cancelled. */
export const SNAP_CEIL: SnapTuning = { minDelta: 0.45, minRate: 7 };
/** A near-miss this close before a fired snap was the same attempt. */
const SAME_INTENT_MS = 4000;
/** Positives needed before the thresholds move at all. */
const MIN_POSITIVES = 3;
const KEEP = 30;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export class SnapLearner {
  private positives: Sample[] = [];
  private negatives: Sample[] = [];
  private pending: (Sample & { t: number })[] = [];
  /** The last fired snap and the near-misses promoted with it, so a cancel can undo them. */
  private lastBatch: { fired: Sample; promoted: Sample[] } | null = null;

  observe(a: SnapAttempt) {
    const sample = { delta: a.delta, rate: a.rate };
    if (!Number.isFinite(a.delta) || !Number.isFinite(a.rate)) return;
    if (!a.fired) {
      this.pending = this.pending.filter((m) => a.t - m.t <= SAME_INTENT_MS);
      this.pending.push({ ...sample, t: a.t });
      return;
    }
    const promoted = this.pending.filter((m) => a.t - m.t <= SAME_INTENT_MS).map(({ delta, rate }) => ({ delta, rate }));
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
    const drop = new Set<Sample>([batch.fired, ...batch.promoted]);
    this.positives = this.positives.filter((p) => !drop.has(p));
    this.negatives.push(batch.fired);
    this.negatives = this.negatives.slice(-KEEP);
  }

  tuning(): SnapTuning {
    let { minDelta, minRate } = DEFAULT_SNAP_TUNING;
    if (this.positives.length >= MIN_POSITIVES) {
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
    return { v: 1, positives: this.positives, negatives: this.negatives };
  }

  /** Restores saved learning; anything malformed is ignored. */
  static from(json: unknown): SnapLearner {
    const l = new SnapLearner();
    const ok = (x: unknown): x is Sample =>
      !!x && typeof x === 'object' && Number.isFinite((x as Sample).delta) && Number.isFinite((x as Sample).rate);
    if (json && typeof json === 'object' && (json as { v?: number }).v === 1) {
      const j = json as { positives?: unknown[]; negatives?: unknown[] };
      l.positives = (Array.isArray(j.positives) ? j.positives.filter(ok) : []).slice(-KEEP);
      l.negatives = (Array.isArray(j.negatives) ? j.negatives.filter(ok) : []).slice(-KEEP);
    }
    return l;
  }
}
