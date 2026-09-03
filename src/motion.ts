// Shared liquid-motion contract. No duration/easing curves anywhere in the
// app — every transition is a spring, so motion always responds to how far
// it has to travel rather than a fixed clock.
export const LIQUID_SPRING = { type: "spring" as const, damping: 15, stiffness: 120, mass: 0.5 };

export const TAP_SCALE = { scale: 0.95 };
export const HOVER_SCALE = { scale: 0.98 };
