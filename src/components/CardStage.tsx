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
  useIsPresent,
  useSpring,
  useTransform,
  type MotionValue,
  type Variants,
} from "framer-motion";
import { FLOAT_SPRING } from "../motion";
import { haptic } from "../haptics";
import CategoryArt from "./CategoryArt";

/* A tapped card detaches into a floating panel. Layout (shared layoutId),
   3D choreography, and pointer parallax each live on their own wrapper so
   the transforms never fight; the panel is portaled so no clipping ancestor
   can crop it. */

interface StageEntry {
  id: string;
  label: string;
  render: () => ReactNode;
  trigger: HTMLElement | null;
  wide: boolean;
}

interface StageContextValue {
  openId: string | null;
  open: (entry: StageEntry) => void;
  close: () => void;
}

/** Passed to the exiting panel: when the source card is gone (filtered away,
 * navigated off) there's nothing to return to, so the panel fades in place
 * instead of flying to a stale position. */
interface ExitInfo {
  sourceGone: boolean;
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

// A drag that ends over the card still produces a tap; anything that moved
// further than this is a swipe, not a request to open.
const TAP_SLOP_PX = 10;

export function CardStageProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<StageEntry | null>(null);
  const [exitInfo, setExitInfo] = useState<ExitInfo>({ sourceGone: false });
  const entryRef = useRef<StageEntry | null>(null);
  // True while a closed panel is still animating out (see open/close).
  const exiting = useRef(false);
  const lastTrigger = useRef<HTMLElement | null>(null);
  // Remounting AnimatePresence drops any exiting panel immediately.
  const [presenceKey, setPresenceKey] = useState(0);

  const finishExit = useCallback(() => {
    exiting.current = false;
  }, []);

  const open = useCallback((next: StageEntry) => {
    if (entryRef.current) return;
    // A tap while the previous panel is still closing drops that panel at
    // once, so two shared-layout transitions never stack and no tap is lost.
    if (exiting.current) {
      setPresenceKey((k) => k + 1);
      finishExit();
    }
    entryRef.current = next;
    lastTrigger.current = next.trigger;
    haptic("light");
    setExitInfo({ sourceGone: false });
    setEntry(next);
  }, [finishExit]);

  const close = useCallback(() => {
    const current = entryRef.current;
    if (!current) return;
    entryRef.current = null;
    exiting.current = true;
    setExitInfo({ sourceGone: !current.trigger?.isConnected });
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

  // Focus returns to the card as soon as it is visible again, not after the
  // closing movement, so keyboard users never sit on a disappearing panel.
  useEffect(() => {
    if (entry || !exiting.current) return;
    if (lastTrigger.current?.isConnected) lastTrigger.current.focus({ preventScroll: true });
  }, [entry]);

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
          <AnimatePresence key={presenceKey} custom={exitInfo} onExitComplete={finishExit}>
            {entry && <StagePanel key={entry.id} entry={entry} exitInfo={exitInfo} onClose={close} />}
          </AnimatePresence>
        </>,
        document.body
      )}
    </StageContext.Provider>
  );
}

/** The app surface behind a floating panel: recedes to 0.96 around the
 * centre of the current viewport, so a card opened far down the page doesn't
 * make the page appear to jump. Keep fixed-position UI (nav) outside it. */
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

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_IN_OUT = [0.4, 0, 0.2, 1] as const;

// One scene: the lift peaks early, then settles at a small retained depth
// (translateZ 16 ≈ 1.3% larger under the 1200px perspective) so the open
// card still reads as raised while being perfectly still for reading.
const depthVariants: Variants = {
  hidden: { z: 0, rotateX: 0, opacity: 1, scale: 1 },
  shown: { z: [0, 60, 16], rotateX: [0, 3, 0], transition: { duration: 0.42, times: [0, 0.45, 1], ease: EASE_OUT } },
  exit: (info: ExitInfo | undefined) =>
    info?.sourceGone
      ? { opacity: 0, scale: 0.96, z: 0, transition: { duration: 0.22, ease: EASE_IN_OUT } }
      : { z: [16, 28, 0], rotateX: [0, -2, 0], transition: { duration: 0.32, ease: EASE_IN_OUT } },
};

const reducedDepthVariants: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

function StagePanel({ entry, exitInfo, onClose }: { entry: StageEntry; exitInfo: ExitInfo; onClose: () => void }) {
  const reduce = !!useReducedMotion();
  // False once closing starts: from then on the whole scene lets taps through
  // to the page, even if the exit animation is still finishing.
  const isPresent = useIsPresent();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const px = useSpring(rawX, { stiffness: 120, damping: 20 });
  const py = useSpring(rawY, { stiffness: 120, damping: 20 });
  const tiltX = useTransform(py, (v) => v * -2.5);
  const tiltY = useTransform(px, (v) => v * 2.5);
  const sheenX = useTransform(px, [-1, 1], ["-12%", "12%"]);
  // Pointer tilt and the pointer-following reflection only exist where a
  // hovering pointer does; touch gets a still, flat panel.
  const finePointer = useMemo(() => window.matchMedia("(hover: hover) and (pointer: fine)").matches, []);

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
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      style={{
        pointerEvents: isPresent ? "auto" : "none",
        perspective: 1200,
        paddingTop: "max(24px, env(safe-area-inset-top))",
        paddingBottom: "max(24px, env(safe-area-inset-bottom))",
      }}
    >
      <motion.div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "rgb(var(--scrim) / 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduce ? 0.15 : 0.3, ease: EASE_IN_OUT }}
      />

      <motion.div
        className={`relative w-full max-w-[420px] ${entry.wide ? "lg:max-w-[880px]" : ""}`}
        style={{ transformStyle: "preserve-3d" }}
        variants={reduce ? reducedDepthVariants : depthVariants}
        custom={exitInfo}
        initial="hidden"
        animate="shown"
        exit="exit"
      >
        {/* Pointer parallax (desktop only). */}
        <motion.div className="relative" style={reduce || !finePointer ? undefined : { rotateX: tiltX, rotateY: tiltY, transformStyle: "preserve-3d" }}>
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 rounded-[22px]"
            style={{ boxShadow: "var(--shadow-float)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.3 } }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
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
            className="relative flex flex-col w-full overflow-hidden border border-line bg-surface"
            style={{
              borderRadius: 22,
              maxHeight: "calc(100dvh - max(24px, env(safe-area-inset-top)) - max(24px, env(safe-area-inset-bottom)))",
              boxShadow: "inset 0 1px 0 rgb(var(--edge) / 0.08)",
            }}
          >
            <motion.div layout transition={layoutTransition} className="relative min-h-0 overflow-y-auto overscroll-contain">
              <DepthContext.Provider value={{ px, py, reduce }}>{entry.render()}</DepthContext.Provider>
            </motion.div>

            <GlassSheen sheenX={sheenX} reduce={reduce} finePointer={finePointer} />

            <motion.button
              ref={closeRef}
              layout
              onClick={onClose}
              aria-label="Close"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.18, duration: 0.2 } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              className="absolute top-3 right-3 z-20 w-11 h-11 rounded-full flex items-center justify-center text-white border border-white/15 outline-none focus-visible:ring-2 focus-visible:ring-rose"
              style={{ background: "rgb(20 18 16 / 0.62)" }}
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

/* Decorative glass only: a single liquid reflection that crosses once and is
   gone before reading starts, a luminous top edge, and (with a mouse) a faint
   pointer-following sheen. Pointer events are off and nothing here filters
   the text or photos underneath. */
function GlassSheen({ sheenX, reduce, finePointer }: { sheenX: MotionValue<string>; reduce: boolean; finePointer: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-hidden" style={{ mixBlendMode: "screen" }}>
      {finePointer && !reduce && (
        <motion.div
          className="absolute inset-y-0 -left-1/4 w-[150%]"
          style={{
            x: sheenX,
            background: "linear-gradient(115deg, transparent 38%, rgb(255 255 255 / 0.05) 48%, rgb(255 255 255 / 0.012) 54%, transparent 64%)",
          }}
        />
      )}
      {!reduce && (
        <motion.div
          className="absolute inset-y-0 left-0 w-2/3"
          style={{
            background: "linear-gradient(100deg, transparent 0%, rgb(243 238 231 / 0.14) 45%, rgb(216 156 164 / 0.12) 60%, transparent 100%)",
            filter: "url(#bhk-liquid)",
          }}
          initial={{ x: "-110%", opacity: 0 }}
          animate={{ x: "210%", opacity: [0, 1, 1, 0] }}
          transition={{ duration: 0.75, delay: 0.12, ease: EASE_IN_OUT }}
        />
      )}
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgb(255 255 255 / 0.22), transparent)" }} />
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
 * carries position, size and corner radius between the two. `wide` panels
 * become a two-column detail view on desktop. */
export function FloatCard({
  id,
  label,
  panel,
  wide = false,
  className = "",
  contentClassName = "",
  radius = 22,
  children,
}: {
  id: string;
  label: string;
  panel: () => ReactNode;
  wide?: boolean;
  className?: string;
  contentClassName?: string;
  radius?: number;
  children: ReactNode;
}) {
  const { openId, open } = useCardStage();
  const reduce = !!useReducedMotion();
  const buttonRef = useRef<HTMLDivElement>(null);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const isOpen = openId === id;

  function trigger() {
    open({ id, label, render: panel, trigger: buttonRef.current, wide });
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    downAt.current = { x: e.clientX, y: e.clientY };
    if (reduce || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setRipples((prev) => [...prev.slice(-2), { id: performance.now(), x: e.clientX - rect.left, y: e.clientY - rect.top }]);
  }

  function handleTap(e: MouseEvent | TouchEvent | PointerEvent) {
    const start = downAt.current;
    downAt.current = null;
    if (start && "clientX" in e && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP_PX) return;
    trigger();
  }

  return (
    <motion.div
      layoutId={id}
      transition={reduce ? { duration: 0 } : FLOAT_SPRING}
      className={`overflow-hidden ${className}`}
      style={{ borderRadius: radius, visibility: isOpen ? "hidden" : "visible", boxShadow: "var(--shadow-card)" }}
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
        onTap={handleTap}
        onPointerDown={handlePointerDown}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            trigger();
          }
        }}
        className="relative h-full w-full cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose"
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
                background: "radial-gradient(circle, rgb(var(--ink) / 0.26) 0%, rgb(var(--accent) / 0.16) 45%, transparent 70%)",
              }}
              initial={{ scale: 0, opacity: 1 }}
              animate={{ scale: 9, opacity: 0 }}
              transition={{ duration: 0.5, ease: EASE_OUT }}
              onAnimationComplete={() => setRipples((prev) => prev.filter((p) => p.id !== rp.id))}
            />
          ))}
        </span>
      </motion.div>
    </motion.div>
  );
}

/** Shared artwork between a card and its panel: the real photo, or the
 * category illustration when there isn't one. */
export function FloatMedia({
  id,
  photo,
  category,
  className = "",
  radius = 0,
  compact = false,
  scrim = false,
}: {
  id: string;
  photo?: string | null;
  category: string | null | undefined;
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
        />
      ) : (
        <motion.div layoutId={`${id}-art`} transition={FLOAT_SPRING} className="absolute inset-0">
          <CategoryArt category={category} compact={compact} />
        </motion.div>
      )}
      {scrim && photo && <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />}
    </motion.div>
  );
}

/** Panel content on its own depth plane: a staggered entrance and a small
 * pointer-parallax offset proportional to `depth`.
 *
 * Deliberately no `exit`: the panel's scene wrapper already fades/moves the
 * whole panel out. A layer with its own exit that mounts after the panel
 * opened (e.g. ratings arriving from the network) and is closed while its
 * entrance is still running never resolves its exit in Framer Motion 13, so
 * AnimatePresence kept the closed panel in the DOM — reproduced 100% in
 * headless QA, 0 hangs across all close timings once removed. */
export function DepthLayer({ depth, className = "", children }: { depth: number; className?: string; children: ReactNode }) {
  const { px, py, reduce } = useContext(DepthContext);
  const x = useTransform(px, (v) => v * depth * 0.6);
  const y = useTransform(py, (v) => v * depth * 0.6);
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 + depth * 0.4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0.18 } : { ...FLOAT_SPRING, delay: 0.06 + depth * 0.01 }}
    >
      <motion.div style={reduce ? undefined : { x, y }}>{children}</motion.div>
    </motion.div>
  );
}
