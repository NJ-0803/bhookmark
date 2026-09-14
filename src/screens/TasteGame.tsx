import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { answerTaste, getTasteResults, getTasteRound, type TasteQuestion, type TasteResults } from "../api";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";
import { haptic } from "../haptics";
import SaveButton from "../components/SaveButton";

type Stage =
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "question"; index: number }
  | { name: "results"; data: TasteResults };

/** A short round of "which place does it better?" questions about places the
 * person actually logged, then their own ranking and places to try next.
 * Their scores are never read into or changed by any of this. */
export default function TasteGame({ category, onClose }: { category: string; onClose: () => void }) {
  const [questions, setQuestions] = useState<TasteQuestion[]>([]);
  const [stage, setStage] = useState<Stage>({ name: "loading" });
  const [sending, setSending] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const startRound = useCallback(async () => {
    setStage({ name: "loading" });
    try {
      const res = await getTasteRound(category);
      if (!res.ok || !res.questions?.length) {
        setStage({ name: "error", message: res.error ?? "No questions right now." });
        return;
      }
      setQuestions(res.questions);
      setStage({ name: "question", index: 0 });
    } catch {
      setStage({ name: "error", message: "Can't reach Bhookmark right now." });
    }
  }, [category]);

  async function showResults() {
    setStage({ name: "loading" });
    try {
      const res = await getTasteResults(category);
      setStage(res.ok ? { name: "results", data: res } : { name: "error", message: res.error ?? "Couldn't load your results." });
    } catch {
      setStage({ name: "error", message: "Can't reach Bhookmark right now." });
    }
  }

  useEffect(() => {
    startRound();
  }, [startRound]);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function answer(question: TasteQuestion, winner: string | null) {
    if (sending || stage.name !== "question") return;
    setSending(true);
    haptic("light");
    try {
      const res = await answerTaste(category, question.options, winner);
      if (!res.ok) {
        setStage({ name: "error", message: res.error ?? "Couldn't save that answer." });
        return;
      }
      if (stage.index + 1 < questions.length) setStage({ name: "question", index: stage.index + 1 });
      else await showResults();
    } catch {
      setStage({ name: "error", message: "Can't reach Bhookmark right now." });
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${category} taste game`}
      className="fixed inset-0 z-[65] bg-bg overflow-y-auto"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}
    >
      <div className="max-w-[460px] mx-auto px-5">
        <div className="flex items-center justify-between h-16">
          <p className="text-[13px] text-rose">Taste game · {category}</p>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-ink border border-line bg-surface">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {stage.name === "loading" && (
          <div className="py-24 text-center">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-muted text-[14px]">One moment…</p>
          </div>
        )}

        {stage.name === "error" && (
          <div className="py-16 text-center">
            <p className="text-[16px] text-ink mb-2">{stage.message}</p>
            <button onClick={onClose} className="mt-4 h-11 px-5 rounded-xl border border-line text-ink text-[15px]">
              Close
            </button>
          </div>
        )}

        {stage.name === "question" && questions[stage.index] && (
          <motion.div key={questions[stage.index].id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={LIQUID_SPRING} className="pt-4">
            <div className="flex gap-1.5 mb-5" aria-hidden="true">
              {questions.map((q, i) => (
                <span key={q.id} className={`h-1 flex-1 rounded-full ${i <= stage.index ? "bg-accent" : "bg-surface2"}`} />
              ))}
            </div>
            <p className="text-[13px] text-muted mb-1">
              Question {stage.index + 1} of {questions.length}
            </p>
            <h2 className="font-display font-semibold text-[26px] leading-tight tracking-[-0.02em] text-ink mb-6">Which place does {category} better?</h2>
            <div className="flex flex-col gap-3">
              {questions[stage.index].options.map((venue) => (
                <motion.button
                  key={venue}
                  whileTap={TAP_SCALE}
                  transition={LIQUID_SPRING}
                  disabled={sending}
                  onClick={() => answer(questions[stage.index], venue)}
                  className="w-full min-h-16 px-5 py-4 rounded-card bg-surface border border-line text-left disabled:opacity-60 hover:border-rose/50 focus-visible:border-rose outline-none"
                >
                  <span className="dish-name text-[22px] text-ink">{venue}</span>
                </motion.button>
              ))}
              <button
                disabled={sending}
                onClick={() => answer(questions[stage.index], null)}
                className="h-12 rounded-xl border border-dashed border-line text-muted text-[15px] disabled:opacity-60"
              >
                Too close to call
              </button>
            </div>
          </motion.div>
        )}

        {stage.name === "results" && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={LIQUID_SPRING} className="pt-4">
            <h2 className="font-display font-semibold text-[26px] leading-tight tracking-[-0.02em] text-ink mb-1">Your {category} ranking</h2>
            <p className="text-[14px] text-muted mb-5">From your answers. Your scores stay exactly as you logged them.</p>
            <ol className="flex flex-col gap-2 mb-8">
              {stage.data.ranking.map((r, i) => (
                <li key={r.venue} className="bg-surface border border-line rounded-2xl p-3.5">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[13px] text-muted tabular w-5 shrink-0">{i + 1}</span>
                    <span className="dish-name text-[19px] text-ink flex-1 min-w-0">{r.venue}</span>
                  </div>
                  <div className="ml-8 mt-2">
                    <div className="h-1.5 rounded-full bg-surface2 overflow-hidden">
                      <div className="h-full bg-accent" style={{ width: `${Math.max(4, r.strength)}%` }} />
                    </div>
                    <p className="text-[12px] text-muted mt-1.5 tabular">
                      {r.wins} {r.wins === 1 ? "win" : "wins"} · your average {r.yourAverage.toFixed(1)} over {r.yourLogs} {r.yourLogs === 1 ? "log" : "logs"}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            {stage.data.suggestions.length > 0 && (
              <section aria-labelledby="try-next" className="mb-8">
                <h3 id="try-next" className="text-[18px] font-medium text-ink">
                  Places to try next
                </h3>
                <p className="text-[13px] text-muted mt-0.5 mb-3">
                  {stage.data.source === "ai"
                    ? `Picked by an AI model (${stage.data.model ?? "Groq"}) from your ranking and real community logs.`
                    : "Ranked from real community logs."}
                </p>
                <div className="flex flex-col gap-2.5">
                  {stage.data.suggestions.map((s) => (
                    <div key={s.id} className="bg-surface border border-line rounded-2xl p-4">
                      <span className="dish-name text-[20px] text-ink">{s.venue}</span>
                      {s.area && <span className="block text-[13px] text-muted mt-0.5">{s.area}</span>}
                      <p className="text-[14px] text-ink/85 mt-2 leading-snug">{s.reason}</p>
                      <div className="mt-3">
                        <SaveButton dish={{ name: s.name, venue: s.venue, area: s.area, category, subtype: s.subtype }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="flex gap-2 pb-6">
              <button onClick={startRound} className="flex-1 h-12 rounded-xl border border-rose/60 text-rose text-[15px] font-medium">
                Play another round
              </button>
              <button onClick={onClose} className="flex-1 h-12 rounded-xl gradient-primary text-accentInk text-[15px] font-medium">
                Done
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>,
    document.body
  );
}
