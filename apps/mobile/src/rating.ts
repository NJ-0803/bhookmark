import type { Verdict } from './api/client';

// Ported from the web app (src/components/RatingPicker.tsx, src/verdictCopy.ts).
// Bhookmark's opinion of the user's own number. It never changes the score.
export function ratingVerdict(score: number): { verdict: Verdict; line: string } {
  if (score >= 9.5) return { verdict: 'loved', line: 'Best in the city. Order it again, no debate.' };
  if (score >= 8.5) return { verdict: 'loved', line: 'A keeper. This goes straight on your go-to list.' };
  if (score >= 8) return { verdict: 'loved', line: 'Genuinely good. Worth coming back for.' };
  if (score >= 7) return { verdict: 'fine', line: 'Solid, but not worth a detour.' };
  if (score >= 5.5) return { verdict: 'fine', line: "Average. You won't crave this one." };
  if (score >= 4) return { verdict: 'not-for-me', line: "Forgettable. There's better nearby." };
  return { verdict: 'not-for-me', line: 'Skip it. Not worth ordering again.' };
}

export const VERDICT_COPY: Record<Verdict, { label: string; tone: 'accent' | 'neutral' | 'bad' }> = {
  loved: { label: 'Obsessed', tone: 'accent' },
  fine: { label: 'Mid', tone: 'neutral' },
  'not-for-me': { label: 'Never again', tone: 'bad' },
};

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
