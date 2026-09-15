// Ported from the web app's src/format.ts so the venue line reads the same.
export function placeLine(dish: { name: string; venue: string; area: string }): string {
  const sameAsName = dish.venue.trim().toLowerCase() === dish.name.trim().toLowerCase();
  if (sameAsName || !dish.venue.trim()) return dish.area;
  return dish.area ? `${dish.venue} · ${dish.area}` : dish.venue;
}
