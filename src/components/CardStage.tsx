import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  motionValue,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { FLOAT_SPRING } from "../motion";
import { haptic } from "../haptics";
import Medallion from "./Medallion";

/* A tapped card detaches into a floating panel. Layout (shared layoutId),
   3D choreography, and pointer parallax each live on their own wrapper so
   the transforms never fight; the panel is portaled so no clipping or
   `contain: paint` ancestor can crop it. */

interface StageEntry {
  id: string;
  label: string;
  render: () => ReactNode;
  trigger: HTMLElement | null;
}

interface StageContextValue {
  openId: string | null;
  open: (entry: StageEntry) => void;
  close: () => void;
}

const StageContext = createContext<StageContextValue>({ openId: null, open: () => {}, close: () => {} });

export function useCardStage() {
  return useContext(StageContext);
}

const DepthContext = createContext<{ px: MotionValue<number>; py: MotionValue<number>; reduce: boolean }>({
  px: motionValue(0),
  py: motionValue(0),
  reduce: true,
});

export function CardStageProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<StageEntry | null>(null);
  const entryRef = useRef<StageEntry | null>(null);
  // Ignores taps while a panel is closing, so rapid repeat taps can't stack
  // two shared-layout transitions on top of each other.
  const exiting = useRef(false);
  const lastTrigger = useRef<HTMLElement | null>(null);

  const open = useCallback((next: StageEntry) => {
    if (entryRef.current || exiting.current) return;
    entryRef.current = next;
    lastTrigger.current = next.trigger;
    haptic("light");
    setEntry(next);
  }, []);

  const close = useCallback(() => {
    if (!entryRef.current) return;
    entryRef.current = null;
    exiting.current = true;
    setEntry(null);
  }, []);

  useEffect(() => {
    if (!entry) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [entry, close]);

  const value = useMemo(() => ({ openId: entry?.id ?? null, open, close }), [entry, open, close]);

  return (
    <StageContext.Provider value={value}>
      {children}
      {createPortal(
        <>
          <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
            <filter id="bhk-liquid" x="-20%" y="-20%" width="140%" height="140%">
              <feTurbulence type="fractalNoise" baseFrequency="0.011 0.018" numOctaves="2" seed="7" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="22" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </svg>
          <AnimatePresence
            onExitComplete={() => {
              exiting.current = false;
              lastTrigger.current?.focus({ preventScroll: true });
            }}
          >
            {entry && <StagePanel key={entry.id} entry={entry} onClose={close} />}
          </AnimatePresence>
        </>,
        document.body
      )}
    </StageContext.Provider>
  );
}

/** The app surface behind a floating panel: recedes to 0.96 around the
 * centre of the current viewport. Keep fixed-position UI (nav) outside it. */
export function StageShell({ children }: { children: ReactNode }) {
  const { openId } = useCardStage();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState("50% 0px");

  useLayoutEffect(() => {
    if (!openId || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setOrigin(`50% ${Math.round(window.innerHeight / 2 - rect.top)}px`);
  }, [openId]);

  return (
    <motion.div
      ref={ref}
      animate={{ scale: openId && !reduce ? 0.96 : 1 }}
      transition={FLOAT_SPRING}
      style={{ transformOrigin: origin }}
    >
      {children}
    </motion.div>
  );
}

function StagePanel({ entry, onClose }: { entry: StageEntry; onClose: () => void }) {
  const reduce = !!useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const px = useSpring(rawX, { stiffness: 120, damping: 20 });
  const py = useSpring(rawY, { stiffness: 120, damping: 20 });
  const tiltX = useTransform(py, (v) => v * -2.5);
  const tiltY = useTransform(px, (v) => v * 2.5);
  const sheenX = useTransform(px, [-1, 1], ["-12%", "12%"]);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (reduce || e.pointerType !== "mouse" || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    rawX.set(((e.clientX - rect.left) / rect.width) * 2 - 1);
    rawY.set(((e.clientY - rect.top) / rect.height) * 2 - 1);
  }

  function resetPointer() {
    rawX.set(0);
    rawY.set(0);
  }

  function trapFocus(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusables = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const layoutTransition = reduce ? { duration: 0 } : FLOAT_SPRING;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-6" style={{ perspective: 1200 }}>
      <motion.div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
        style={{ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduce ? 0.15 : 0.35, ease: [0.4, 0, 0.2, 1] }}
      />

      {/* 3D choreography: forward on translateZ with a brief tilt, then flat for reading. */}
      <motion.div
        className="relative w-full max-w-[420px]"
        style={{ transformStyle: "preserve-3d" }}
        initial={reduce ? { opacity: 0 } : { z: 0, rotateX: 0 }}
        animate={reduce ? { opacity: 1 } : { z: [0, 80, 0], rotateX: [0, 4, 0] }}
        exit={
          reduce
            ? { opacity: 0 }
            : { z: [0, 50, 0], rotateX: [0, -3, 0], transition: { duration: 0.45, ease: [0.4, 0, 0.2, 1] } }
        }
        transition={reduce ? { duration: 0.2 } : { duration: 0.6, times: [0, 0.42, 1], ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Pointer parallax (desktop only). */}
        <motion.div className="relative" style={reduce ? undefined : { rotateX: tiltX, rotateY: tiltY, transformStyle: "preserve-3d" }}>
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 rounded-[22px]"
            style={{ boxShadow: "0 50px 100px -30px rgba(0,0,0,0.95), 0 24px 48px -24px rgba(122,18,25,0.4)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.22, duration: 0.4 } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          />

          <motion.div
            ref={panelRef}
            layoutId={entry.id}
            transition={layoutTransition}
            role="dialog"
            aria-modal="true"
            aria-label={entry.label}
            onKeyDown={trapFocus}
            onPointerMove={handlePointerMove}
            onPointerLeave={resetPointer}
            className="relative flex flex-col w-full overflow-hidden border border-[#9B1B24]/35 bg-[rgba(16,16,16,0.88)]"
            style={{
              borderRadius: 22,
              maxHeight: "calc(100dvh - 48px)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.09), inset 0 0 0 1px rgba(255,255,255,0.04)",
            }}
          >
            <motion.div layout transition={layoutTransition} className="relative min-h-0 overflow-y-auto overscroll-contain">
              <DepthContext.Provider value={{ px, py, reduce }}>{entry.render()}</DepthContext.Provider>
            </motion.div>

            <GlassSheen sheenX={sheenX} reduce={reduce} />

            <motion.button
              ref={closeRef}
              layout
              onClick={onClose}
              aria-label="Close"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.25, duration: 0.25 } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              className="absolute top-3 right-3 z-20 w-10 h-10 rounded-full flex items-center justify-center text-ink bg-black/55 border border-white/10 outline-none focus-visible:border-[#C9525A]"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </motion.button>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}

/* Decorative glass only: a pointer-following reflection, a one-time liquid
   shimmer (the only distorted layer), and a luminous top edge. It sits over
   the content with pointer-events off and screen blending, so text and
   photos underneath are never filtered. */
function GlassSheen({ sheenX, reduce }: { sheenX: MotionValue<string>; reduce: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-hidden" style={{ mixBlendMode: "screen" }}>
      <motion.div
        className="absolute inset-y-0 -left-1/4 w-[150%]"
        style={{
          x: reduce ? 0 : sheenX,
          background: "linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.06) 47%, rgba(255,255,255,0.015) 53%, transparent 64%)",
        }}
      />
      {!reduce && (
        <motion.div
          className="absolute inset-y-0 left-0 w-2/3"
          style={{
            background: "linear-gradient(100deg, transparent 0%, rgba(237,232,225,0.14) 45%, rgba(155,27,36,0.12) 60%, transparent 100%)",
            filter: "url(#bhk-liquid)",
          }}
          initial={{ x: "-110%", opacity: 0 }}
          animate={{ x: "210%", opacity: [0, 1, 1, 0] }}
          transition={{ duration: 1.15, delay: 0.2, ease: [0.4, 0, 0.2, 1] }}
        />
      )}
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)" }} />
    </div>
  );
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

/** A tappable card that lifts into a floating panel. Hidden (not unmounted)
 * while its panel is open so the list keeps its layout; the shared layoutId
 * carries position, size and corner radius between the two. */
export function FloatCard({
  id,
  label,
  panel,
  className = "",
  contentClassName = "",
  radius = 16,
  children,
}: {
  id: string;
  label: string;
  panel: () => ReactNode;
  className?: string;
  contentClassName?: string;
  radius?: number;
  children: ReactNode;
}) {
  const { openId, open } = useCardStage();
  const reduce = !!useReducedMotion();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const isOpen = openId === id;

  function trigger() {
    open({ id, label, render: panel, trigger: buttonRef.current });
  }

  function spawnRipple(e: ReactPointerEvent<HTMLDivElement>) {
    if (reduce || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setRipples((prev) => [...prev.slice(-2), { id: performance.now(), x: e.clientX - rect.left, y: e.clientY - rect.top }]);
  }

  return (
    <motion.div
      layoutId={id}
      transition={reduce ? { duration: 0 } : FLOAT_SPRING}
      className={`overflow-hidden ${className}`}
      style={{ borderRadius: radius, visibility: isOpen ? "hidden" : "visible" }}
    >
      <motion.div
        ref={buttonRef}
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        whileTap={reduce ? undefined : { scale: 0.98 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        onTap={trigger}
        onPointerDown={spawnRipple}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            trigger();
          }
        }}
        className="relative h-full w-full cursor-pointer text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#C9525A]"
        style={{ borderRadius: radius }}
      >
        <motion.div layout transition={reduce ? { duration: 0 } : FLOAT_SPRING} className={contentClassName}>
          {children}
        </motion.div>
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" style={{ borderRadius: radius }}>
          {ripples.map((rp) => (
            <motion.span
              key={rp.id}
              className="absolute w-8 h-8 -ml-4 -mt-4 rounded-full"
              style={{
                left: rp.x,
                top: rp.y,
                background: "radial-gradient(circle, rgba(237,232,225,0.32) 0%, rgba(155,27,36,0.16) 45%, transparent 70%)",
              }}
              initial={{ scale: 0, opacity: 1 }}
              animate={{ scale: 9, opacity: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              onAnimationComplete={() => setRipples((prev) => prev.filter((p) => p.id !== rp.id))}
            />
          ))}
        </span>
      </motion.div>
    </motion.div>
  );
}

/** Shared artwork between a card and its panel: a photo, or the engraved
 * medallion when there's no photo. */
export function FloatMedia({
  id,
  photo,
  seed,
  className = "",
  radius = 0,
  compact = false,
  scrim = false,
}: {
  id: string;
  photo?: string | null;
  seed: string;
  className?: string;
  radius?: number;
  compact?: boolean;
  scrim?: boolean;
}) {
  const positioned = /\b(absolute|fixed)\b/.test(className) ? "" : "relative";
  return (
    <motion.div
      layoutId={id}
      transition={FLOAT_SPRING}
      className={`${positioned} overflow-hidden bg-surface2 ${className}`}
      style={{ borderRadius: radius }}
    >
      {photo ? (
        <motion.img
          layoutId={`${id}-img`}
          transition={FLOAT_SPRING}
          src={photo}
          alt=""
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: "saturate(0.85)" }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div layoutId={`${id}-mark`} transition={FLOAT_SPRING} className={compact ? "w-[88%] h-[88%]" : "h-[62%] aspect-square"}>
            <Medallion seed={seed} label={seed} className="w-full h-full" />
          </motion.div>
        </div>
      )}
      {scrim && <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />}
    </motion.div>
  );
}

/** Panel content on its own depth plane: a staggered entrance and a small
 * pointer-parallax offset proportional to `depth`. */
export function DepthLayer({ depth, className = "", children }: { depth: number; className?: string; children: ReactNode }) {
  const { px, py, reduce } = useContext(DepthContext);
  const x = useTransform(px, (v) => v * depth * 0.6);
  const y = useTransform(py, (v) => v * depth * 0.6);
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 + depth * 0.5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={reduce ? { duration: 0.2 } : { ...FLOAT_SPRING, delay: 0.1 + depth * 0.012 }}
    >
      <motion.div style={reduce ? undefined : { x, y }}>{children}</motion.div>
    </motion.div>
  );
}
