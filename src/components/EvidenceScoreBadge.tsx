import ScoreBadge from "./ScoreBadge";

/** Phase 1 honesty fix (2026-09-10): several cards used to render a dish's
 * static seed `score` through <ScoreBadge>, indistinguishable from a real
 * community rating — that's what the "fake reviews" complaint was about.
 * This wrapper only ever shows a number once real evidence (`count > 0`)
 * exists; otherwise it renders an honestly-labeled "no logs yet" chip in
 * the same visual language ScoreBadge already uses for a low/no-confidence
 * dish, so a viewer can tell "real, but new" apart from "invented." */
interface Props {
  community: { score: number | null; count: number } | undefined;
  size?: "sm" | "md";
  className?: string;
}

export default function EvidenceScoreBadge({ community, size = "md", className = "" }: Props) {
  const dims = size === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1";

  if (!community) {
    // Still loading — render nothing rather than a placeholder number.
    return null;
  }
  if (community.count === 0 || community.score === null) {
    return (
      <span
        className={`tabular inline-flex items-center gap-1 rounded-md border border-dashed border-line text-faint font-mono font-medium ${dims} ${className}`}
      >
        no logs yet
      </span>
    );
  }
  return <ScoreBadge score={community.score} size={size} className={className} />;
}
