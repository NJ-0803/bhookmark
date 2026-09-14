import { useEffect, useState } from "react";
import { getTasteStatus, type TasteStatus } from "../api";
import TasteGame from "../screens/TasteGame";

/** Entry point for the taste game on the You page: play buttons for every
 * unlocked category, or honest progress toward the first unlock. */
export default function TasteGameCard({ logCount }: { logCount: number }) {
  const [status, setStatus] = useState<TasteStatus | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    if (playing) return;
    let cancelled = false;
    getTasteStatus()
      .then((res) => {
        if (!cancelled && res.ok) setStatus(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [logCount, playing]);

  if (!status || status.categories.length === 0) return null;
  const unlocked = status.categories.filter((c) => c.eligible);
  const closest = status.categories[0];

  return (
    <section aria-labelledby="taste-game" className="bg-surface border border-line rounded-card p-4">
      <h2 id="taste-game" className="text-[16px] font-medium text-ink">
        Taste game
      </h2>
      {unlocked.length > 0 ? (
        <>
          <p className="text-[14px] text-muted mt-1 leading-snug">
            Quick questions about places you've actually logged. Your answers build your own ranking and point you to places worth trying.
          </p>
          <div className="flex flex-wrap gap-2 mt-3.5">
            {unlocked.map((c) => (
              <button key={c.category} onClick={() => setPlaying(c.category)} className="h-11 px-4 rounded-xl gradient-primary text-accentInk text-[15px] font-medium">
                Play {c.category}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-[14px] text-muted mt-1 leading-snug">
            Unlocks once one kind of food reaches {status.minLogs} logs from at least {status.minPlaces} different places.
          </p>
          <div className="mt-3.5">
            <div
              className="w-full h-1.5 rounded-full bg-surface2 overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={status.minLogs}
              aria-valuenow={Math.min(closest.logs, status.minLogs)}
              aria-label="Progress toward the taste game"
            >
              <div className="h-full bg-accent" style={{ width: `${Math.min(100, (closest.logs / status.minLogs) * 100)}%` }} />
            </div>
            <p className="text-muted text-[12px] tabular mt-1.5">
              Closest: {closest.category}, {closest.logs} of {status.minLogs}
              {closest.places < status.minPlaces ? ` · ${closest.places} of ${status.minPlaces} places` : ""}
            </p>
          </div>
        </>
      )}
      {playing && <TasteGame category={playing} onClose={() => setPlaying(null)} />}
    </section>
  );
}
