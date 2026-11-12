import type { DirectoryEntry } from "./restaurantDirectory";

// Patiala branch photos, reviewed on 2026-11-12. Keyed by the seed venue id
// from server/scripts/patiala-catalog-seed.sql; localRestaurant falls back to
// this map when a venue row has no OSM id. Only rights-verified assets are
// enabled here: an official-site image being publicly accessible is not reuse
// permission, so official-site candidates stay in the research-only list at
// server/scripts/patiala-photo-research.json until permission is grounded.
// Gopal Sweets is a bundled Wikimedia Commons image under CC BY-SA 4.0 -
// author, source and license in public/restaurant-photos/ATTRIBUTION.md.
export const patialaDirectory: Record<string, DirectoryEntry> = {
  "seed-patiala-gopal-sweets": { name: "Gopal Sweets", address: "Two branches mapped in the city", aliases: "Gopal Sweets Gopal's Patiala",
    photo: { url: "/restaurant-photos/gopal-sweets-patiala.jpg", sourceUrl: "https://commons.wikimedia.org/wiki/File:Gopal%27s_in_Patiala,_Punjab.jpg", provider: "Wikimedia Commons", year: 2017,
      authors: [{ name: "Titodutta", url: "https://commons.wikimedia.org/wiki/User:Titodutta" }], license: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
      description: "Gopal's shopfront in Patiala, 2017" } },
};
