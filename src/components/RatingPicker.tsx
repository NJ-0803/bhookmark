import type { Verdict } from "../types";

// Bhookmark's opinion of the user's own number. It never changes the score.
export function ratingVerdict(score: number): { verdict: Verdict; line: string } {
  if (score >= 9.5) return { verdict: "loved", line: "Best in the city. Order it again, no debate." };
  if (score >= 8.5) return { verdict: "loved", line: "A keeper. This goes straight on your go-to list." };
  if (score >= 8) return { verdict: "loved", line: "Genuinely good. Worth coming back for." };
  if (score >= 7) return { verdict: "fine", line: "Solid, but not worth a detour." };
  if (score >= 5.5) return { verdict: "fine", line: "Average. You won't crave this one." };
  if (score >= 4) return { verdict: "not-for-me", line: "Forgettable. There's better nearby." };
  return { verdict: "not-for-me", line: "Skip it. Not worth ordering again." };
}

export default function RatingPicker({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const nudge = (delta: number) => onChange(Math.min(10, Math.max(0, (value ?? 5) + delta)));

  return (
    <div>
      <div className="flex items-baseline justify-center gap-1.5">
        <span className="font-display font-light text-[56px] leading-none tracking-[-0.04em] tabular text-ink">
          {value === null ? "—" : value.toFixed(1)}
        </span>
        <span className="text-faint text-sm">/ 10</span>
      </div>
      <p className="text-center text-[13px] text-muted min-h-[2.8em] mt-3 mb-6 px-4">
        {value === null ? "Slide to set your score." : ratingVerdict(value).line}
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => nudge(-0.5)}
          aria-label="Lower by half a point"
          className="w-11 h-11 shrink-0 rounded-full border border-line text-muted text-lg"
        >
          −
        </button>
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={value ?? 5}
          onChange={(e) => onChange(Number(e.target.value))}
          // A tap on the thumb's starting spot fires no change event; still count it as a choice.
          onClick={(e) => onChange(Number(e.currentTarget.value))}
          aria-label="Your rating out of 10"
          className="rating-range flex-1"
        />
        <button
          type="button"
          onClick={() => nudge(0.5)}
          aria-label="Raise by half a point"
          className="w-11 h-11 shrink-0 rounded-full border border-line text-muted text-lg"
        >
          +
        </button>
      </div>
      <div className="flex justify-between text-faint text-[10px] font-mono mt-2 px-14">
        <span>0</span>
        <span>5</span>
        <span>10</span>
      </div>
    </div>
  );
}
