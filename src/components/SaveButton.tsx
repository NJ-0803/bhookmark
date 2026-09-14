import { useSaves, type SaveInput } from "../saves";
import { useCardStage } from "./CardStage";

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3.5h10a1 1 0 0 1 1 1V20l-6-3.6L6 20V4.5a1 1 0 0 1 1-1z" />
    </svg>
  );
}

/** Save-for-later toggle. `inline` is the labelled button used in panels;
 * `overlay` is the round icon button that sits over a card's photo. */
export default function SaveButton({ dish, variant = "inline", className = "" }: { dish: SaveInput; variant?: "inline" | "overlay"; className?: string }) {
  const { isSaved, toggle } = useSaves();
  const saved = isSaved(dish.name, dish.venue);
  const label = saved ? `Remove ${dish.name} from saved` : `Save ${dish.name} for later`;

  if (variant === "overlay") {
    return (
      <button
        type="button"
        onClick={() => toggle(dish)}
        aria-pressed={saved}
        aria-label={label}
        className={`w-11 h-11 rounded-full flex items-center justify-center text-white border border-white/15 outline-none focus-visible:ring-2 focus-visible:ring-rose active:scale-95 transition-transform ${className}`}
        style={{ background: "rgb(20 18 16 / 0.55)" }}
      >
        <BookmarkIcon filled={saved} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => toggle(dish)}
      aria-pressed={saved}
      aria-label={label}
      className={`h-12 px-4 rounded-xl border flex items-center justify-center gap-2 text-[15px] shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-rose active:scale-[0.98] transition-transform ${
        saved ? "border-rose/60 text-rose bg-accentDim" : "border-line text-ink bg-surface"
      } ${className}`}
    >
      <BookmarkIcon filled={saved} />
      {saved ? "Saved" : "Save"}
    </button>
  );
}

/** The overlay save button for a floating card. It is a sibling of the card
 * (never nested inside its tap target) and hides while that card is lifted
 * into its panel, where the panel's own Save button takes over. */
export function CardSaveButton({ cardId, dish, className = "" }: { cardId: string; dish: SaveInput; className?: string }) {
  const { openId } = useCardStage();
  return (
    <div className={className} style={{ visibility: openId === cardId ? "hidden" : "visible" }}>
      <SaveButton dish={dish} variant="overlay" />
    </div>
  );
}
