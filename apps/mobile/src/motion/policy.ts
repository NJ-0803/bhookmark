// Motion policy from the native motion brief. Every number here is an initial
// tuning value, not a measured result — Step 5 (physical release builds)
// is where these get tuned against real frame traces.
//
// Direction change (user, 2026-09-15): transitions should be bold,
// dimensional and distinctive. During a transformation, pronounced
// perspective, artwork breaking beyond its frame, temporary text movement and
// selective distortion are allowed; the interface must be clear and still on
// arrival. This supersedes the brief's "maximum 3 degrees / keep text upright"
// limits for the in-flight phase only. Every in-flight effect is driven by a
// curve that is zero at both ends (see `flightPeak`), so reversing mid-flight
// is continuous and rest states are never distorted. Colours, typography and
// product structure are unchanged, and reduced motion disables all of it.

import { Easing } from 'react-native-reanimated';

export type QualityTier = 'full' | 'standard' | 'reduced';

/**
 * Flight curve. The in-flight effects peak at progress 0.5; an ease-out
 * reached that ~75 ms after the tap, so the dimensional part flashed by and
 * read as flat (user feedback, 2026-09-15). This curve still starts moving on
 * the first frame but lingers through mid-flight before settling.
 */
export const flightEasing = Easing.bezier(0.45, 0, 0.15, 1);

export const timing = {
  /** Source card compresses on contact. */
  pressIn: 60,
  /** Main card-to-detail travel (longer than the brief's 280–360 to carry the bolder arc; still interruptible at any point). */
  open: 540,
  /** Secondary details fade in, overlapping the travel. */
  reveal: 130,
  close: 420,
  /** One highlight pass across decorative material. */
  sweep: 240,
  /** Routine tab change: brief opacity/translation only. */
  tab: 160,
  parallaxReturn: 180,
} as const;

export const limits = {
  pressScale: 0.985,
  backgroundScale: 0.97,
  /** Resting tilt from touch parallax once the detail has arrived. */
  maxTiltDeg: 3,
  /** Touch parallax offset for the hero artwork. */
  parallaxDp: 8,
  maxDepthLayers: 3,
  /** Movement allowed before a touch stops counting as a tap. */
  tapSlopDp: 10,
} as const;

/** Peak values reached mid-transition; each returns to zero on arrival. */
export const flight = {
  /** Artwork pitches back as it lifts out of the frame. */
  artRotateXDeg: 24,
  /** Artwork yaws with the pitch, for a non-flat arc. */
  artRotateYDeg: 14,
  /** Extra rise beyond the resting lift, so it clearly breaks the frame top. */
  artExtraLiftDp: 34,
  /** Overshoot scale at the peak, on top of the resting lift scale. */
  artExtraScale: 0.14,
  /** Selective distortion: a shear and vertical squash on the artwork only. */
  artSkewXDeg: 8,
  artSquash: 0.08,
  /** The detaching panel surface swings in 3D on its way out. */
  shellRotateXDeg: 10,
  shellRotateYDeg: -12,
  /** Background plane tips away and recedes further at the peak. */
  backgroundRotateXDeg: 12,
  backgroundExtraRecede: 0.05,
  /** Dish name and caption drift and dim during flight, then settle. */
  textDriftDp: 20,
  textDim: 0.5,
  textRotateXDeg: 18,
} as const;

/** 0 at rest (p = 0 or 1), 1 at mid-flight. Continuous under reversal. */
export function flightPeak(p: number): number {
  'worklet';
  return Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
}

export const frameBudgetMs = {
  120: 1000 / 120,
  90: 1000 / 90,
  60: 1000 / 60,
} as const;

export type TierEffects = {
  perspective: boolean;
  parallax: boolean;
  highlight: boolean;
  shadowLayers: 0 | 1 | 2;
  /** In-flight shear/squash on the artwork. */
  distortion: boolean;
  /** Temporary name/caption drift during flight. */
  textFlight: boolean;
};

// Full: every in-flight effect, layered shadow, one brief highlight.
// Standard (the performance fallback): keeps the dimensional arc and text
// drift (transform-only, cheap) but drops the highlight and second shadow.
// Reduced (OS Reduce Motion or in-app Reduce effects): plain fade, no
// perspective, parallax, zoom, distortion, text movement or sweep.
export function effectsFor(tier: QualityTier): TierEffects {
  switch (tier) {
    case 'full':
      return { perspective: true, parallax: true, highlight: true, shadowLayers: 2, distortion: true, textFlight: true };
    case 'standard':
      return { perspective: true, parallax: true, highlight: false, shadowLayers: 1, distortion: true, textFlight: true };
    case 'reduced':
      return { perspective: false, parallax: false, highlight: false, shadowLayers: 0, distortion: false, textFlight: false };
  }
}
