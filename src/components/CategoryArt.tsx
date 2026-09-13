import type { ReactNode } from "react";

/* Fine-line category illustrations: the fallback wherever a dish or venue
   has no real photo. Readable at chip size, restrained at card size. */

const GLYPHS: Record<string, ReactNode> = {
  Coffee: (
    <>
      <path d="M12 20h20v9a9 9 0 0 1-9 9h-2a9 9 0 0 1-9-9z" />
      <path d="M32 23h2.5a4 4 0 0 1 0 8H32" />
      <path d="M18 9.5c-1.8 2.6 1.8 3.8 0 6.5M24 8.5c-1.8 2.6 1.8 3.8 0 6.5M30 9.5c-1.8 2.6 1.8 3.8 0 6.5" />
      <path d="M8 42h30" />
    </>
  ),
  Pizza: (
    <>
      <path d="M9 14.5c9.5-5 20.5-5 30 0L24 42z" />
      <path d="M11.8 19.5c7.6-3.6 16.8-3.6 24.4 0" />
      <circle cx="21" cy="25" r="1.8" />
      <circle cx="27.5" cy="29" r="1.8" />
      <circle cx="23" cy="34" r="1.5" />
    </>
  ),
  Burger: (
    <>
      <path d="M10 23a14 11 0 0 1 28 0z" />
      <path d="M9 28h30" />
      <path d="M9 32.5c3-2 5 2 7.5 0s5 2 7.5 0 5 2 7.5 0 5 2 7.5 0" />
      <path d="M11 37h26v1.5a3.5 3.5 0 0 1-3.5 3.5h-19A3.5 3.5 0 0 1 11 38.5z" />
      <path d="M19 16.5h.01M25 15h.01M29 18h.01" />
    </>
  ),
  Biryani: (
    <>
      <path d="M12.5 23h23l-1.8 12.5a6 6 0 0 1-6 5.1h-7.4a6 6 0 0 1-6-5.1z" />
      <path d="M9 23h30" />
      <path d="M15 23a9 7 0 0 1 18 0" />
      <path d="M24 12.5V16" />
      <path d="M8.5 27H12M36 27h3.5" />
    </>
  ),
  "Dosa & Idli": (
    <>
      <ellipse cx="24" cy="35" rx="18" ry="5.5" />
      <path d="M9 31.5 38 19l2.5 8.5L10 33.5" />
      <path d="M16 29l1.5 3.5M24 25.5l1.5 4M31.5 22.5l1.5 4" />
    </>
  ),
  "Ice Cream": (
    <>
      <path d="M16.5 23 24 42l7.5-19" />
      <path d="M15 23a9 9 0 0 1 18 0z" />
      <path d="M19 29.5l8-3M20.5 34l6-2.2" />
      <path d="M24 14v-3" />
    </>
  ),
  Momos: (
    <>
      <path d="M10 33c0-9.5 6.3-17 14-17s14 7.5 14 17z" />
      <path d="M24 16v6M18.5 18l2 4.5M29.5 18l-2 4.5" />
      <path d="M7 33h34" />
      <path d="M12 38h24" />
    </>
  ),
  "Bakery & Sweets": (
    <>
      <path d="M14 27h20l-2.8 14h-14.4z" />
      <path d="M11.5 27a12.5 9.5 0 0 1 25 0z" />
      <path d="M19.5 27l1 14M28.5 27l-1 14" />
      <circle cx="24" cy="14.5" r="2.2" />
    </>
  ),
  "Bars & Pubs": (
    <>
      <path d="M13 12h19l-2 26a4 4 0 0 1-4 3.7h-7a4 4 0 0 1-4-3.7z" />
      <path d="M14 19h17" />
      <path d="M31.5 21h3a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H31" />
      <path d="M19 25v10M25 25v10" />
    </>
  ),
  Chinese: (
    <>
      <path d="M8 26h32c0 8.5-7 14-16 14S8 34.5 8 26z" />
      <path d="M13.5 26c2-3 4-3 6 0s4 3 6 0 4-3 6 0" />
      <path d="M27 7l-7 17M36 9.5 25 24" />
    </>
  ),
  "North Indian": (
    <>
      <path d="M10 25h28c0 8-6.3 13-14 13s-14-5-14-13z" />
      <path d="M5.5 25H10M38 25h4.5" />
      <path d="M19 18.5c-1.6-2.2 1.6-3.3 0-5.5M24 17.5c-1.6-2.2 1.6-3.3 0-5.5M29 18.5c-1.6-2.2 1.6-3.3 0-5.5" />
      <path d="M17 43h14" />
    </>
  ),
  "Rolls & Kebabs": (
    <>
      <path d="M8 40 40 8" />
      <rect x="13.5" y="25.5" width="9" height="9" rx="3" transform="rotate(-45 18 30)" />
      <rect x="19.5" y="19.5" width="9" height="9" rx="3" transform="rotate(-45 24 24)" />
      <rect x="25.5" y="13.5" width="9" height="9" rx="3" transform="rotate(-45 30 18)" />
    </>
  ),
  "South Indian Meals & Tiffin": (
    <>
      <path d="M6 32c7-14.5 23-21 36-18.5-4.5 13-19.5 22-36 18.5z" />
      <path d="M8.5 31 39.5 15" />
      <circle cx="19" cy="29" r="3" />
      <circle cx="28" cy="23.5" r="3" />
    </>
  ),
  "Street Food & Chaat": (
    <>
      <path d="M8 28h32c-1.8 8-8 12.5-16 12.5S9.8 36 8 28z" />
      <circle cx="17" cy="23" r="4.8" />
      <circle cx="26.5" cy="21" r="5" />
      <circle cx="34" cy="24.2" r="3.6" />
    </>
  ),
};

const FALLBACK = (
  <>
    <path d="M16 8v11a4 4 0 0 0 8 0V8M20 8v34" />
    <path d="M32 8c-3.5 3.5-3.5 13 0 16.5V42" />
  </>
);

export function CategoryGlyph({ category, className = "" }: { category: string | null | undefined; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {(category && GLYPHS[category]) || FALLBACK}
    </svg>
  );
}

/** A photo stand-in: the category line drawing on a quiet warm surface. */
export default function CategoryArt({
  category,
  compact = false,
  className = "",
}: {
  category: string | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 flex items-center justify-center bg-surface2 text-rose ${className}`}
      style={{ backgroundImage: "radial-gradient(120% 90% at 30% 15%, rgb(var(--accent) / 0.16), transparent 60%)" }}
    >
      <CategoryGlyph category={category} className={compact ? "w-[58%] h-[58%] opacity-80" : "h-[42%] max-h-40 aspect-square opacity-70"} />
    </div>
  );
}
