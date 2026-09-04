import { motion, AnimatePresence } from "framer-motion";
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
  return (
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
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100) onClose();
            }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[460px] bg-surface border-t border-line rounded-t-[24px] max-h-[80vh] overflow-y-auto"
          >
            <div className="w-9 h-1 rounded-full bg-line mx-auto mt-3 mb-1" />
            <div className="flex items-center justify-between px-5 py-3 border-b border-line">
              <h2 className="font-display font-bold text-base">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-3 flex items-center justify-center text-muted">
                ✕
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
