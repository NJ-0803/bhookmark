export interface RestaurantPhoto { url: string; sourceUrl: string; authors: { name: string; url: string }[]; provider?: string; license?: { name: string; url: string }; year?: number; description?: string }
export interface Restaurant {
  id: string; name: string; address: string; source: "google" | "osm" | "manual" | "legacy";
  lat?: number; lng?: number; mapsUrl: string; photos: RestaurantPhoto[];
  attributions?: { provider: string; providerUri: string }[];
  featured?: boolean; category?: string; identitySource?: string; ratingCount?: number;
}
export interface Bookmark {
  id: string; restaurantId: string; restaurantName: string; address: string;
  name: string; note: string; referenceUrl: string; tried: boolean; rating: number | null; savedAt: number;
}
export type BookmarkInput = Omit<Bookmark, "id" | "savedAt">;
export interface SearchResult {
  restaurants: Restaurant[]; source: "google" | "osm"; nextPageToken: string | null; nextOffset: number | null; notice: string | null;
}
