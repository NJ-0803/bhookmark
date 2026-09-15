// The Log a bite category picker, ported from the web app's src/data/dishes.ts
// CATEGORIES (the same 7 categories and subtypes, plus "Other — not listed"
// in the flow itself). Browsing uses the server's /venues/categories instead.
export const LOG_CATEGORIES: { name: string; subtypes: string[] }[] = [
  { name: 'Dosa & Idli', subtypes: ['Plain / Set Dosa', 'Masala Dosa', 'Benne Dosa', 'Idli-Vada'] },
  { name: 'Biryani', subtypes: ['Chicken', 'Mutton', 'Veg', 'Egg'] },
  { name: 'Coffee', subtypes: ['Filter Coffee', 'Cold Coffee', 'Cappuccino / Latte', 'Specialty / Third Wave'] },
  { name: 'Burger', subtypes: ['Veg', 'Chicken', 'Mutton / Beef'] },
  { name: 'Pizza', subtypes: ['Veg', 'Non-veg'] },
  { name: 'Momos', subtypes: ['Veg', 'Chicken'] },
  { name: 'Ice Cream', subtypes: ['Classic', 'Sundae / Loaded'] },
];
