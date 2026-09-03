import { scoreEmoji } from "../verdictCopy";

interface Props {
  score: number;
  verified?: boolean;
  size?: "sm" | "md";
}

export default function ScoreBadge({ score, verified, size = "md" }: Props) {
  const tone =
    score >= 8.5 ? "text-accent border-accent/40 bg-accentDim" :
    score >= 7 ? "text-gold border-gold/40 bg-gold/10" :
    "text-muted border-line bg-surface2";

  const dims = size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-2.5 py-1";

  return (
    <span className={`tabular inline-flex items-center gap-1 rounded-md border font-mono font-medium ${tone} ${dims}`}>
      <span aria-hidden="true">{scoreEmoji(score)}</span>
      {score.toFixed(1)}
      {verified && <span title="Verified log" className="text-accent">✓</span>}
    </span>
  );
}
