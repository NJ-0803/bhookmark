export type Category = "Dosa & Idli" | "Biryani" | "Coffee" | "Burger" | "Pizza" | "Momos" | "Ice Cream";

export type Verdict = "loved" | "fine" | "not-for-me";

export interface DishEntry {
  id: string;
  category: Category;
  subtype: string;
  name: string;
  venue: string;
  area: string;
  emoji: string;
  tint: string; // tailwind gradient classes for the placeholder thumbnail
  score: number; // 0-10, relative within subtype
  verifiedPct: number; // 0-100
  logCount: number;
  priceRs: number;
  tasteNotes: string[];
  allergens: string[];
  photo?: string;
}

export interface JournalLog {
  id: string;
  dishId: string;
  verdict: Verdict;
  score: number;
  verified: boolean;
  note: string;
  timestamp: string; // e.g. "2 days ago"
  reorder: boolean;
}
