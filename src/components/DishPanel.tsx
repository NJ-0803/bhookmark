import { useEffect, useState } from "react";
import { getDishScore, type DishScoreResponse } from "../api";
import type { DishEntry } from "../types";
import WhyThis from "./WhyThis";
import { DepthLayer, FloatMedia, useCardStage } from "./CardStage";

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

  return (
    <>
      <FloatMedia id={mediaId} photo={photo} seed={dish.category} className="aspect-[16/10]" scrim />
      <div className="p-5">
        <DepthLayer depth={6}>
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint mb-2">{dish.category}</p>
          <h2 className="dish-name text-[20px] text-ink">{dish.name}</h2>
          <p className="text-muted text-[13px] mt-2">
            {dish.venue} · {dish.area}
          </p>
        </DepthLayer>

        {reason && (
          <DepthLayer depth={9} className="mt-5">
            <p className="text-[13px] text-ink/85 leading-relaxed">{reason}</p>
            <WhyThis body="Grounded in your real dietary profile and log history — a fixed template, no AI model wrote this." />
          </DepthLayer>
        )}

        {flagged.length > 0 && (
          <DepthLayer depth={9} className="mt-5">
            <div className="border border-bad/40 bg-badDim rounded-xl px-4 py-3 text-[13px] text-bad">
              Contains {flagged.join(", ")} — flagged against your dietary profile.
            </div>
          </DepthLayer>
        )}

        {score && score.community.count > 0 && (
          <DepthLayer depth={11} className="mt-5">
            <div className="border border-line rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">Ratings from real logs</p>
                <span className="text-[10px] font-mono uppercase tracking-wide text-faint border border-line rounded px-1.5 py-0.5">
                  {score.confidenceBand}
                </span>
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
                  <span key={i} className="text-xs border border-line rounded-full px-3 py-1.5 text-ink/90">
                    {n.note}
                  </span>
                ))}
              </div>
            )}
          </DepthLayer>
        )}

        <DepthLayer depth={14} className="mt-6">
          <button
            onClick={() => {
              close();
              onLog(dish);
            }}
            className="w-full bg-accent text-accentInk font-medium rounded-xl py-3.5 active:scale-[0.98] transition-transform"
          >
            I ate this — log it
          </button>
        </DepthLayer>
      </div>
    </>
  );
}

function ScoreRow({ label, score, count, highlight }: { label: string; score: number | null; count: number; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={`text-[13px] ${highlight ? "text-accent" : "text-ink/80"}`}>{label}</span>
      <span className="font-mono text-[13px] tabular text-ink/90">
        {score !== null ? score.toFixed(1) : "—"}
        <span className="text-faint text-[11px] ml-1.5">{count === 1 ? "1 log" : `${count} logs`}</span>
      </span>
    </div>
  );
}
