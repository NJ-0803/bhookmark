/** Venue or area to show under a dish name, without repeating the name when
 * the "dish" is really just the venue (most OSM-sourced entries, where the
 * dish name falls back to the venue's own name). */
export function placeLine(dish: { name: string; venue: string; area: string }): string {
  const sameAsName = dish.venue.trim().toLowerCase() === dish.name.trim().toLowerCase();
  if (sameAsName || !dish.venue.trim()) return dish.area;
  return dish.area ? `${dish.venue} · ${dish.area}` : dish.venue;
}
