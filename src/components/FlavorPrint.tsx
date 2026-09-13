import { useMemo } from "react";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// Hypotrochoid rosette — the curve family guilloche engraving is built from.
// Integer R and r close the curve after r / gcd(R, r) turns.
function rosettePath(R: number, r: number, d: number, radius: number): string {
  const turns = r / gcd(R, r);
  const steps = turns * 120;
  const k = (R - r) / r;
  const scale = radius / (R - r + d);
  let path = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * 2 * Math.PI;
    const x = 50 + scale * ((R - r) * Math.cos(t) + d * Math.cos(k * t));
    const y = 50 + scale * ((R - r) * Math.sin(t) - d * Math.sin(k * t));
    path += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return path + "Z";
}

const ROLLING_RADII = [7, 9, 11, 13, 17, 19];

/** The taste fingerprint: a rosette seeded by the person's signature
 * category. Reserved for Flavor DNA. `faded` renders it ghosted while the
 * feature is still locked. */
export default function FlavorPrint({ seed, faded = false, className = "" }: { seed: string; faded?: boolean; className?: string }) {
  const { outer, inner } = useMemo(() => {
    const h = hash(seed);
    const r1 = ROLLING_RADII[h % ROLLING_RADII.length];
    const r2 = ROLLING_RADII[(h >>> 8) % ROLLING_RADII.length];
    return {
      outer: rosettePath(100, r1, r1 * (1.6 + ((h >>> 4) % 5) * 0.2), 46),
      inner: rosettePath(60, r2, r2 * (1.2 + ((h >>> 12) % 4) * 0.2), 28),
    };
  }, [seed]);

  return (
    <svg viewBox="0 0 100 100" className={`${className} ${faded ? "opacity-40" : ""}`} aria-hidden="true" focusable="false">
      <path d={outer} fill="none" className="stroke-ink" strokeOpacity="0.22" strokeWidth="0.4" />
      <path d={inner} fill="none" className="stroke-rose" strokeOpacity="0.7" strokeWidth="0.45" />
    </svg>
  );
}
