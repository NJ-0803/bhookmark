import type { TasteAnswer } from "./db";

export interface RankedPlace {
  venue: string;
  /** 0–100, relative to the strongest place in this person's ranking. */
  strength: number;
  wins: number;
  losses: number;
  comparisons: number;
}

/** A person's own ranking of places from their head-to-head answers, using
 * the standard Bradley–Terry model (iterative MM updates). Each place also
 * plays half a win against a virtual average opponent, so a single answer
 * can't send a place to infinity or zero. Places never compared still appear,
 * at the average. */
export function rankFromAnswers(venues: string[], answers: TasteAnswer[]): RankedPlace[] {
  const n = venues.length;
  if (n === 0) return [];
  const index = new Map(venues.map((v, i) => [v, i]));
  const wins = new Array<number>(n).fill(0);
  const losses = new Array<number>(n).fill(0);
  const comparisons = new Array<number>(n).fill(0);
  const games = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const scored = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (const a of answers) {
    const i = index.get(a.winner);
    const j = index.get(a.loser);
    if (i === undefined || j === undefined || i === j) continue;
    games[i][j]++;
    games[j][i]++;
    comparisons[i]++;
    comparisons[j]++;
    if (a.tie) {
      scored[i][j] += 0.5;
      scored[j][i] += 0.5;
    } else {
      scored[i][j] += 1;
      wins[i]++;
      losses[j]++;
    }
  }

  let p = new Array<number>(n).fill(1);
  for (let iter = 0; iter < 200; iter++) {
    const next = p.map((pi, i) => {
      let won = 0.5; // prior: half a win against a virtual opponent of strength 1
      let denom = 1 / (pi + 1);
      for (let j = 0; j < n; j++) {
        if (games[i][j] === 0) continue;
        won += scored[i][j];
        denom += games[i][j] / (pi + p[j]);
      }
      return won / denom;
    });
    const mean = next.reduce((s, x) => s + x, 0) / n;
    const normalised = next.map((x) => x / mean);
    const delta = Math.max(...normalised.map((x, i) => Math.abs(x - p[i])));
    p = normalised;
    if (delta < 1e-9) break;
  }

  const max = Math.max(...p);
  return venues
    .map((venue, i) => ({ venue, strength: Math.round((p[i] / max) * 100), wins: wins[i], losses: losses[i], comparisons: comparisons[i] }))
    .sort((a, b) => b.strength - a.strength || b.wins - a.wins || a.venue.localeCompare(b.venue));
}
