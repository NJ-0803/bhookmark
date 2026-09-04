import { useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

// One of the three deliberate depth moments in the app (the others: Home's
// CravingOrb, the Circles match reveal) — CSS 3D tilt + a holographic sheen
// tied to pointer position, no WebGL. A collectible-feeling card is a
// tilt-on-pointer effect and a moving gradient, not a rendering pipeline.
function bhookmarkLevel(dishesLogged: number): string {
  if (dishesLogged >= 25) return "City Icon";
  if (dishesLogged >= 10) return "Local Legend";
  if (dishesLogged >= 3) return "Regular";
  return "New Tongue";
}

export default function PassportCard({
  name,
  city,
  dishesLogged,
  verifiedPct,
  repeatCount,
  cravingCategory,
}: {
  name: string;
  city: string;
  dishesLogged: number;
  verifiedPct: number;
  repeatCount: number;
  cravingCategory: string | null;
}) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const springX = useSpring(px, { stiffness: 200, damping: 20 });
  const springY = useSpring(py, { stiffness: 200, damping: 20 });
  const rotateX = useTransform(springY, [0, 1], [8, -8]);
  const rotateY = useTransform(springX, [0, 1], [-8, 8]);
  const sheenX = useTransform(springX, [0, 1], ["0%", "100%"]);
  const sheenY = useTransform(springY, [0, 1], ["0%", "100%"]);

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (reduceMotion || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width);
    py.set((e.clientY - rect.top) / rect.height);
  }

  function reset() {
    px.set(0.5);
    py.set(0.5);
  }

  return (
    <motion.div
      ref={ref}
      onPointerMove={handlePointerMove}
      onPointerLeave={reset}
      style={{ rotateX: reduceMotion ? 0 : rotateX, rotateY: reduceMotion ? 0 : rotateY, transformPerspective: 800 }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 120, damping: 18 }}
      className="relative rounded-card p-5 mb-5 overflow-hidden border border-accent/30 bg-gradient-to-br from-surface via-surface to-accentDim/60"
    >
      {/* Holographic sheen — a soft light patch that tracks the pointer,
          exactly like a foil ID card catching light as you tilt it. */}
      {!reduceMotion && (
        <motion.div
          className="absolute inset-0 pointer-events-none mix-blend-overlay"
          style={{
            background: useTransform([sheenX, sheenY], ([x, y]) => `radial-gradient(circle at ${x} ${y}, rgba(255,255,255,0.35), transparent 45%)`),
          }}
        />
      )}

      <div className="relative flex items-start justify-between mb-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-accent/80 mb-0.5">Bhookmark Passport</p>
          <h1 className="font-display font-bold text-xl leading-tight">{name}</h1>
          <p className="text-faint text-xs mt-0.5">{city}</p>
        </div>
        {/* Verification stamp — a rotated badge, the "holographic" beat the
            brief asked for, without needing a real hologram texture. */}
        <div className="shrink-0 -rotate-12 border-2 border-accent/60 rounded-lg px-2 py-1 text-center">
          <div className="text-accent font-mono text-[9px] font-bold tracking-wide leading-none">VERIFIED</div>
          <div className="text-accent/70 font-mono text-[8px] tracking-wide">MEMBER</div>
        </div>
      </div>

      <span className="inline-block mb-4 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-accent text-accentInk">
        {bhookmarkLevel(dishesLogged)}
      </span>

      <div className="grid grid-cols-3 gap-2.5">
        <PassportStat label="Dishes logged" value={String(dishesLogged)} />
        <PassportStat label="Verified" value={`${verifiedPct}%`} />
        <PassportStat label="Would bhookmark again" value={String(repeatCount)} />
      </div>

      {cravingCategory && (
        <p className="relative mt-4 text-sm text-ink/90">
          Signature craving: <span className="text-accent font-semibold">{cravingCategory}</span>
        </p>
      )}
    </motion.div>
  );
}

function PassportStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg/40 border border-line rounded-xl p-3 text-center">
      <div className="font-mono text-lg font-semibold tabular text-accent">{value}</div>
      <div className="text-faint text-[10px] mt-0.5">{label}</div>
    </div>
  );
}
