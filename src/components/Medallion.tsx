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

// Hypotrochoid rosette — the curve family banknote guilloche engraving is
// built from. Integer R and r close the curve after r / gcd(R, r) turns.
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

// Two-letter monogram ("Bars & Pubs" → "BP", "Biryani" → "Bi") so
// neighbouring categories that share a first letter still read differently.
function monogram(label: string): string {
  const words = label.split(/[\s&/-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  return label.charAt(0).toUpperCase() + label.charAt(1).toLowerCase();
}

/** Engraved-style emblem: two guilloche rosettes, hairline blood-red rings,
 * and a serif initial. Deterministic per seed, so a category always gets the
 * same pattern. */
export default function Medallion({ seed, label, className = "" }: { seed: string; label?: string; className?: string }) {
  const { outer, inner } = useMemo(() => {
    const h = hash(seed);
    const r1 = ROLLING_RADII[h % ROLLING_RADII.length];
    const r2 = ROLLING_RADII[(h >>> 8) % ROLLING_RADII.length];
    return {
      outer: rosettePath(100, r1, r1 * (1.6 + ((h >>> 4) % 5) * 0.2), 44),
      inner: rosettePath(60, r2, r2 * (1.2 + ((h >>> 12) % 4) * 0.2), 27),
    };
  }, [seed]);

  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <circle cx="50" cy="50" r="49.2" fill="#0E0E0E" stroke="#7A1219" strokeWidth="0.8" />
      <path d={outer} fill="none" stroke="#E9E2D6" strokeOpacity="0.16" strokeWidth="0.35" />
      <path d={inner} fill="none" stroke="#B9464F" strokeOpacity="0.4" strokeWidth="0.35" />
      <circle cx="50" cy="50" r="18" fill="#0E0E0E" stroke="#7A1219" strokeWidth="0.5" />
      {label && (
        <text
          x="50"
          y="51"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily='"Instrument Serif", Georgia, serif'
          fontSize="19"
          letterSpacing="0.6"
          fill="#EDE8E1"
          fillOpacity="0.9"
        >
          {monogram(label)}
        </text>
      )}
    </svg>
  );
}
