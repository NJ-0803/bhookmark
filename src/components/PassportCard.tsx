import { useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

// A collectible-feeling card: CSS 3D tilt + a sheen tied to a mouse pointer
// (touch stays flat), no WebGL.
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
  onLogFirst,
}: {
  name: string;
  city: string;
  dishesLogged: number;
  verifiedPct: number;
  repeatCount: number;
  cravingCategory: string | null;
  onLogFirst: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const springX = useSpring(px, { stiffness: 200, damping: 20 });
  const springY = useSpring(py, { stiffness: 200, damping: 20 });
  const rotateX = useTransform(springY, [0, 1], [6, -6]);
  const rotateY = useTransform(springX, [0, 1], [-6, 6]);
  const sheenX = useTransform(springX, [0, 1], ["0%", "100%"]);
  const sheenY = useTransform(springY, [0, 1], ["0%", "100%"]);
  // Hooks run unconditionally (reduced motion can toggle at runtime); only
  // the JSX that uses the result is conditional.
  const sheenBackground = useTransform([sheenX, sheenY], ([x, y]) => `radial-gradient(circle at ${x} ${y}, rgb(255 255 255 / 0.22), transparent 45%)`);

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (reduceMotion || e.pointerType !== "mouse" || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width);
    py.set((e.clientY - rect.top) / rect.height);
  }

  function reset() {
    px.set(0.5);
    py.set(0.5);
  }

  const isNew = dishesLogged === 0;

  return (
    <motion.div
      ref={ref}
      onPointerMove={handlePointerMove}
      onPointerLeave={reset}
      style={{ rotateX: reduceMotion ? 0 : rotateX, rotateY: reduceMotion ? 0 : rotateY, transformPerspective: 900 }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 120, damping: 18 }}
      className="relative rounded-card p-5 mb-3 overflow-hidden border border-line bg-gradient-to-br from-surface via-surface to-accentDim"
    >
      {!reduceMotion && <motion.div className="absolute inset-0 pointer-events-none mix-blend-overlay" style={{ background: sheenBackground }} />}

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-rose mb-1">Bhookmark Passport</p>
          <h1 className="font-display font-semibold text-[24px] leading-tight tracking-[-0.015em] text-ink truncate">{name}</h1>
          <p className="text-muted text-[14px] mt-0.5">{city}</p>
        </div>
        <span className="shrink-0 text-[12px] px-2.5 py-1 rounded-full border border-rose/40 text-rose">{bhookmarkLevel(dishesLogged)}</span>
      </div>

      {isNew ? (
        <div className="relative mt-5 rounded-2xl border border-line bg-bg/40 p-4">
          <p className="text-[16px] text-ink">Your passport starts with one dish.</p>
          <p className="text-[14px] text-muted mt-1 leading-snug">
            Log what you ate and how good it really was. Your stats, your journal and your Flavor DNA grow from there.
          </p>
          <button onClick={onLogFirst} className="mt-4 w-full h-12 rounded-xl gradient-primary text-accentInk text-[15px] font-medium active:scale-[0.98] transition-transform">
            Log your first dish
          </button>
        </div>
      ) : (
        <div className="relative grid grid-cols-3 gap-2.5 mt-5">
          <PassportStat label="Dishes logged" value={String(dishesLogged)} />
          <PassportStat label="Verified" value={`${verifiedPct}%`} />
          <PassportStat label="Would bhookmark again" value={String(repeatCount)} />
        </div>
      )}

      {cravingCategory && (
        <p className="relative mt-4 text-[14px] text-ink/90">
          Signature craving: <span className="text-rose">{cravingCategory}</span>
        </p>
      )}
    </motion.div>
  );
}

function PassportStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg/40 border border-line rounded-xl p-3 text-center">
      <div className="font-display text-[22px] font-semibold tabular text-ink">{value}</div>
      <div className="text-muted text-[12px] mt-0.5 leading-tight">{label}</div>
    </div>
  );
}
