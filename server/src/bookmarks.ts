import { neon } from "@neondatabase/serverless";
import { z } from "zod";

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Database unavailable");
  return neon(url);
}

// Ratings are nullable, private, manually entered scores. No default score.
export const bookmarkSchema = z.object({
  restaurantId: z.string().trim().min(1).max(300).regex(/^(google|osm|manual|legacy):.+$/),
  restaurantName: z.string().trim().min(1).max(160),
  address: z.string().trim().max(300).default(""),
  name: z.string().trim().min(1).max(120),
  note: z.string().trim().max(2000).default(""),
  referenceUrl: z.union([z.literal(""), z.url().refine((s) => /^https?:\/\//i.test(s))]).default(""),
  tried: z.boolean().default(false),
  rating: z.number().min(0).max(10).multipleOf(0.5).nullable().default(null),
}).strict().refine((b) => b.rating === null || b.tried, { message: "Mark this dish tried before rating it.", path: ["rating"] });

export type BookmarkInput = z.infer<typeof bookmarkSchema>;
export interface Bookmark extends BookmarkInput { id: string; savedAt: number }

export function fromRow(r: Record<string, any>): Bookmark {
  return { id: r.id, restaurantId: r.restaurant_id, restaurantName: r.restaurant_name, address: r.address,
    name: r.name, note: r.note, referenceUrl: r.reference_url, tried: r.tried,
    rating: r.rating === null ? null : Number(r.rating), savedAt: Number(r.created_at) };
}

export interface BookmarkStore {
  list(userId: string): Promise<Bookmark[]>;
  save(userId: string, id: string, input: BookmarkInput): Promise<Bookmark | null>;
  update(userId: string, id: string, input: BookmarkInput): Promise<Bookmark | null>;
  remove(userId: string, id: string): Promise<boolean>;
}

export function createBookmarkStore(connect: typeof sql = sql): BookmarkStore { return {
  async list(userId) {
    return (await connect()`SELECT * FROM food_bookmarks WHERE user_id = ${userId} ORDER BY created_at DESC`).map(fromRow);
  },
  async save(userId, id, b) {
    // Serialize saves per account, including the 500-item cap and duplicate
    // check. Different branches use different restaurant ids, never names.
    const db = connect();
    const rows = await db.transaction([
      db`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`,
      db`INSERT INTO food_bookmarks (id, user_id, restaurant_id, restaurant_name, address, name, note, reference_url, tried, rating, created_at)
         SELECT ${id}, ${userId}, ${b.restaurantId}, ${b.restaurantName}, ${b.address}, ${b.name}, ${b.note}, ${b.referenceUrl}, ${b.tried}, ${b.rating}, ${Date.now()}
         WHERE (SELECT COUNT(*) FROM food_bookmarks WHERE user_id = ${userId}) < 500
           OR EXISTS (SELECT 1 FROM food_bookmarks WHERE user_id = ${userId} AND restaurant_id = ${b.restaurantId} AND lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(trim(${b.name}), '[[:space:]]+', ' ', 'g')))
         ON CONFLICT (user_id, restaurant_id, (lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g'))))
         DO NOTHING
         RETURNING *`,
      db`SELECT * FROM food_bookmarks WHERE user_id = ${userId} AND restaurant_id = ${b.restaurantId}
        AND lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(trim(${b.name}), '[[:space:]]+', ' ', 'g'))`,
    ]);
    return rows[1][0] ? fromRow(rows[1][0]) : rows[2][0] ? fromRow(rows[2][0]) : null;
  },
  async update(userId, id, b) {
    const rows = await connect()`UPDATE food_bookmarks SET note = ${b.note}, reference_url = ${b.referenceUrl}, tried = ${b.tried}, rating = ${b.rating}
      WHERE user_id = ${userId} AND id = ${id} AND restaurant_id = ${b.restaurantId}
        AND lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(trim(${b.name}), '[[:space:]]+', ' ', 'g')) RETURNING *`;
    return rows[0] ? fromRow(rows[0]) : null;
  },
  async remove(userId, id) {
    return (await connect()`DELETE FROM food_bookmarks WHERE id = ${id} AND user_id = ${userId} RETURNING id`).length > 0;
  },
}; }
export const bookmarkStore = createBookmarkStore();
