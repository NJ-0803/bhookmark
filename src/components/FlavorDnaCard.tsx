import type { RemoteLog } from "../api";
import { EARLY_LOGS_NEEDED, LOGS_NEEDED, VENUES_NEEDED, categoryCounts, signatureCraving } from "../evidenceThresholds";
import FlavorPrint from "./FlavorPrint";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Flavor DNA, one rule everywhere: it counts all of a person's logs grouped
 * by category, and says so. The progress line always names the category
 * that is actually closest, so "1 of 3" can never read like a counting bug
 * when someone has logged three different kinds of food. */
export default function FlavorDnaCard({ logs, className = "" }: { logs: RemoteLog[]; className?: string }) {
  const result = signatureCraving(logs);
  const counts = categoryCounts(logs);
  const top = counts[0];
  const total = counts.reduce((n, c) => n + c.logs, 0);

  let body: string;
  let progress: { value: number; max: number; label: string } | null = null;

  if (result.tier === "unlocked") {
    body = `${result.category} shows up more than anything else in your Bhookmarks${result.band === "strong" ? " — a real, repeated pattern by now." : "."}`;
  } else if (result.tier === "early") {
    body = `An early signal: you keep coming back to ${result.category}. It becomes your signature once it reaches ${LOGS_NEEDED} logs from ${VENUES_NEEDED} different places.`;
    const logsPart = Math.min(result.logsSeen / LOGS_NEEDED, 1);
    const venuesPart = Math.min(result.venuesSeen / VENUES_NEEDED, 1);
    progress = {
      value: Math.round(Math.min(logsPart, venuesPart) * 100),
      max: 100,
      label: `${result.category}: ${result.logsSeen} of ${LOGS_NEEDED} logs · ${result.venuesSeen} of ${VENUES_NEEDED} places`,
    };
  } else if (!top) {
    body = `A fingerprint of what you actually eat, built only from your own logs. It starts once one kind of food reaches ${EARLY_LOGS_NEEDED} logs.`;
    progress = { value: 0, max: EARLY_LOGS_NEEDED, label: `0 of ${EARLY_LOGS_NEEDED} logs in any one category` };
  } else {
    body = `It counts logs per kind of food, and starts once one of them reaches ${EARLY_LOGS_NEEDED}. You've logged ${plural(total, "dish", "dishes")} across ${plural(counts.length, "category", "categories")} so far.`;
    progress = { value: top.logs, max: EARLY_LOGS_NEEDED, label: `Closest: ${top.category}, ${top.logs} of ${EARLY_LOGS_NEEDED}` };
  }

  const seed = result.tier === "insufficient" ? top?.category ?? "bhookmark" : result.category;

  return (
    <section aria-labelledby="flavor-dna" className={`bg-surface border border-line rounded-card p-4 ${className}`}>
      <div className="flex gap-4">
        <FlavorPrint seed={seed} faded={result.tier !== "unlocked"} className="w-[72px] h-[72px] shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 id="flavor-dna" className="text-[16px] font-medium text-ink">
            Flavor DNA
          </h2>
          <p className="text-[14px] text-muted mt-1 leading-snug">{body}</p>
        </div>
      </div>
      {progress && (
        <div className="mt-3.5">
          <div
            className="w-full h-1.5 rounded-full bg-surface2 overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.max}
            aria-valuenow={Math.min(progress.value, progress.max)}
            aria-label="Progress toward Flavor DNA"
          >
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, (progress.value / progress.max) * 100)}%` }} />
          </div>
          <p className="text-muted text-[12px] tabular mt-1.5">{progress.label}</p>
        </div>
      )}
    </section>
  );
}
