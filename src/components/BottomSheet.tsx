import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { LIQUID_SPRING } from "../motion";

/** Shared expandable-settings sheet — moves Dietary Profile, Allergens,
 * Devices, and the restaurant-claim form off the main Passport view so it
 * doesn't read like an account-settings screen (brief: progressive
 * disclosure instead of showing every option at once). */
export default function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const dragControls = useDragControls();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // V04/V05 (implementation brief, 2026-09-08): body-scroll lock while a
  // sheet is open (otherwise the page behind can scroll along with sheet
  // gestures — one of the "frozen scrolling / nav overlap" symptoms the
  // brief asks to check), plus real focus handling: move focus into the
  // sheet on open, restore it to whatever triggered the sheet on close,
  // matching standard modal accessibility expectations.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-40"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={LIQUID_SPRING}
            drag="y"
            // V04: dragListener off + a controls handle means only a touch
            // that actually starts on the grab handle can drag-to-dismiss.
            // Previously the whole sheet (including its scrollable body)
            // was one drag target, so scrolling long content and
            // dismissing the sheet fought over the same gesture.
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100) onClose();
            }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[460px] bg-surface border-t border-line rounded-t-[24px] max-h-[80dvh] flex flex-col"
          >
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="w-full py-3 flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing touch-none"
            >
              <div className="w-9 h-1 rounded-full bg-line" />
            </div>
            <div className="flex items-center justify-between px-5 pb-3 border-b border-line shrink-0">
              <h2 className="font-display font-bold text-base">{title}</h2>
              <button ref={closeButtonRef} onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-3 flex items-center justify-center text-muted">
                ✕
              </button>
            </div>
            {/* V04: content scrolls natively and independently of the drag
                handle above — overscroll-contain stops a rubber-band
                scroll at the top/bottom of this list from bleeding into
                the page behind the (now scroll-locked) sheet. */}
            <div className="p-5 overflow-y-auto overscroll-contain" style={{ touchAction: "pan-y" }}>
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
