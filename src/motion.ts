// Shared liquid-motion contract. No duration/easing curves anywhere in the
// app — every transition is a spring, so motion always responds to how far
// it has to travel rather than a fixed clock.
// Near-critically damped: settles fast with no visible wobble, which is what
// reads as "expensive" motion; the old damping 15 / stiffness 120 overshot.
export const LIQUID_SPRING = { type: "spring" as const, damping: 28, stiffness: 260, mass: 0.9 };

// Card-to-panel lift: damping ratio ~0.76 gives a small overshoot and
// settles in roughly half a second.
export const FLOAT_SPRING = { type: "spring" as const, stiffness: 140, damping: 18, mass: 1 };

// Scroll reveals: slow and slightly overdamped, so sections glide in with
// no bounce.
export const REVEAL_SPRING = { type: "spring" as const, stiffness: 70, damping: 20, mass: 1 };

export const TAP_SCALE = { scale: 0.95 };
export const HOVER_SCALE = { scale: 0.98 };
