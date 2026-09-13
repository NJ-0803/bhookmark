import { useEffect, useState } from "react";
import { getDishScore, type DishScoreResponse } from "../api";
import type { DishEntry } from "../types";
import { placeLine } from "../format";
import WhyThis from "./WhyThis";
import { DepthLayer, FloatMedia, useCardStage } from "./CardStage";

/** The expanded dish: the same artwork and name as the card, the logging
 * action within reach, real ratings when they exist, and the recommendation
 * explanation last. On desktop the photo and the details sit side by side. */
export default function DishPanel({
  dish,
  mediaId,
  photo,
  reason,
  userAllergens,
  onLog,
}: {
  dish: DishEntry;
  mediaId: string;
  photo?: string | null;
  reason?: string;
  userAllergens: string[];
  onLog: (dish: DishEntry) => void;
}) {
  const { close } = useCardStage();
  const [score, setScore] = useState<DishScoreResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDishScore(dish.venue, dish.category, dish.subtype, dish.name)
      .then((res) => {
        if (!cancelled) setScore(res.ok ? res : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dish.venue, dish.category, dish.subtype, dish.name]);

  const flagged = dish.allergens.filter((a) => userAllergens.includes(a));
  const categoryLabel = dish.category === ("Uncategorized" as string) ? "Place" : dish.category;

  return (
    <div className="lg:grid lg:grid-cols-2">
      <FloatMedia
        id={mediaId}
        photo={photo}
        category={dish.category}
        className="aspect-[4/3] lg:aspect-auto lg:sticky lg:top-0 lg:self-start lg:h-[min(560px,calc(100dvh-48px))]"
        scrim
      />
      <div className="p-5 lg:p-7">
        <DepthLayer depth={6}>
          <p className="text-[13px] text-muted mb-1.5">{categoryLabel}</p>
          <h2 className="dish-name text-[30px] text-ink lg:pr-12">{dish.name}</h2>
          <p className="text-muted text-[15px] mt-2">{placeLine(dish)}</p>
        </DepthLayer>

        {flagged.length > 0 && (
          <DepthLayer depth={8} className="mt-5">
            <div className="border border-bad/40 bg-badDim rounded-xl px-4 py-3 text-[14px] text-bad">
              Contains {flagged.join(", ")} — flagged against your dietary profile.
            </div>
          </DepthLayer>
        )}

        <DepthLayer depth={10} className="mt-5">
          <button
            onClick={() => {
              close();
              onLog(dish);
            }}
            className="w-full h-12 gradient-primary text-accentInk text-[15px] font-medium rounded-xl active:scale-[0.98] transition-transform"
          >
            I ate this — log it
          </button>
        </DepthLayer>

        {score && score.community.count > 0 && (
          <DepthLayer depth={12} className="mt-6">
            <div className="border border-line rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[14px] font-medium text-ink">Ratings from real logs</p>
                <span className="text-[12px] text-muted border border-line rounded-full px-2 py-0.5">{score.confidenceBand}</span>
              </div>
              <ScoreRow label="Community" score={score.community.score} count={score.community.count} />
              <ScoreRow label="Verified only" score={score.verifiedOnly.score} count={score.verifiedOnly.count} />
              {score.yours && <ScoreRow label="Your rating" score={score.yours.score} count={1} highlight />}
              <WhyThis
                body={`Community averages every published log for this dish at this venue; verified-only counts just the logs with a matched location. Confidence is "${score.confidenceBand}" because it rests on ${score.community.count} log${score.community.count === 1 ? "" : "s"}.`}
              />
            </div>
            {score.notes.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {score.notes.map((n, i) => (
                  <span key={i} className="text-[13px] border border-line rounded-full px-3 py-1.5 text-ink/90">
                    {n.note}
                  </span>
                ))}
              </div>
            )}
          </DepthLayer>
        )}

        {reason && (
          <DepthLayer depth={14} className="mt-6 border-t border-line pt-4">
            <p className="text-[13px] text-faint mb-1">Why this pick</p>
            <p className="text-[14px] text-muted leading-relaxed">{reason}</p>
            <WhyThis body="Grounded in your real dietary profile and log history — a fixed template, no AI model wrote this." />
          </DepthLayer>
        )}
      </div>
    </div>
  );
}

function ScoreRow({ label, score, count, highlight }: { label: string; score: number | null; count: number; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={`text-[14px] ${highlight ? "text-rose" : "text-ink/85"}`}>{label}</span>
      <span className="font-mono text-[14px] tabular text-ink">
        {score !== null ? score.toFixed(1) : "—"}
        <span className="text-muted text-[12px] ml-1.5">{count === 1 ? "1 log" : `${count} logs`}</span>
      </span>
    </div>
  );
}
