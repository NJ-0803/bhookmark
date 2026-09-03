// A small server-side mirror of the app's dish catalog, extended with the
// diet/allergen tags recommendations need. In a real system this comes from
// the actual dish database, not a hardcoded list.

export interface CatalogDish {
  id: string;
  category: string;
  subtype: string;
  name: string;
  venue: string;
  score: number;
  dietTags: ("veg" | "egg" | "non-veg" | "vegan")[];
  allergens: string[]; // e.g. "dairy", "gluten", "nuts"
}

export const CATALOG: CatalogDish[] = [
  { id: "d1", category: "Dosa & Idli", subtype: "Benne Dosa", name: "Benne Masala Dosa", venue: "CTR (Shri Sagar)", score: 9.1, dietTags: ["veg"], allergens: ["dairy", "gluten"] },
  { id: "d2", category: "Dosa & Idli", subtype: "Plain / Set Dosa", name: "Set Dosa (3pc)", venue: "Vidyarthi Bhavan", score: 8.8, dietTags: ["vegan", "veg"], allergens: ["gluten"] },
  { id: "d3", category: "Dosa & Idli", subtype: "Idli-Vada", name: "Idli Vada Combo", venue: "Brahmin's Coffee Bar", score: 8.5, dietTags: ["vegan", "veg"], allergens: ["gluten"] },
  { id: "d4", category: "Biryani", subtype: "Chicken", name: "Chicken Dum Biryani", venue: "Meghana Foods", score: 8.9, dietTags: ["non-veg"], allergens: ["dairy"] },
  { id: "d5", category: "Biryani", subtype: "Mutton", name: "Mutton Biryani", venue: "Empire Restaurant", score: 8.3, dietTags: ["non-veg"], allergens: ["dairy"] },
  { id: "d6", category: "Biryani", subtype: "Veg", name: "Veg Biryani", venue: "Nagarjuna", score: 7.9, dietTags: ["veg"], allergens: ["dairy", "nuts"] },
  { id: "d7", category: "Filter Coffee", subtype: "Strong / Degree", name: "Degree Coffee", venue: "Vidyarthi Bhavan", score: 9.0, dietTags: ["veg"], allergens: ["dairy"] },
  { id: "d8", category: "Filter Coffee", subtype: "Cold Filter Coffee", name: "Cold Filter Coffee", venue: "Third Wave Coffee", score: 8.1, dietTags: ["veg"], allergens: ["dairy"] },
  { id: "d9", category: "Burger", subtype: "Chicken", name: "Peri Peri Chicken Burger", venue: "Truffles", score: 8.4, dietTags: ["non-veg"], allergens: ["gluten", "dairy"] },
  { id: "d10", category: "Burger", subtype: "Veg", name: "Farmer's Veg Burger", venue: "Airlines Hotel", score: 7.6, dietTags: ["veg"], allergens: ["gluten", "dairy"] },
  { id: "d11", category: "Pizza", subtype: "Veg", name: "Margherita Pizza", venue: "Toscano", score: 8.5, dietTags: ["veg"], allergens: ["gluten", "dairy"] },
  { id: "d12", category: "Pizza", subtype: "Non-veg", name: "Pepperoni Pizza", venue: "Fava", score: 8.2, dietTags: ["non-veg"], allergens: ["gluten", "dairy"] },
];
