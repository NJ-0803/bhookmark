import { verifiedRestaurants } from "./verifiedRestaurants";
import type { RestaurantPhoto } from "./restaurants";

export interface DirectoryEntry {
  name: string; address: string; aliases: string;
  identitySource?: string;
  category?: "Fine dining" | "Well-known" | "Bengaluru classic";
  featuredRank?: number;
  photo?: RestaurantPhoto;
}

// Reviewed on 2026-11-11. These are editorial picks, never fabricated ratings.
// Match exact OSM branches so spelling corrections preserve saved-item identity.
export const restaurantDirectory: Record<string, DirectoryEntry> = {
  ...Object.fromEntries(Object.entries(verifiedRestaurants).map(([id, entry], i) => [id, { ...entry, category: "Bengaluru classic" as const, featuredRank: 50 + i }])),
  "node/3761073062": { name: "Karavalli", address: "Vivanta, 66 Residency Road, Bengaluru", aliases: "Karavalli Vivanta Gateway", category: "Fine dining", featuredRank: 1,
    identitySource: "https://www.vivantahotels.com/en-in/hotels/vivanta-bengaluru-residency-road/restaurants/karavalli-bengaluru-residency-road" },
  "node/10591455581": { name: "LUPA", address: "Spencer's Towers, 86 MG Road, Bengaluru", aliases: "Lupa Manu Chandra", category: "Fine dining", featuredRank: 2,
    identitySource: "https://lupa.co.in/contact/" },
  "node/9177560311": { name: "FarmLore", address: "Survey 67, Sathnur Village, Bagalur, Bengaluru", aliases: "Farmlore Farm Lore", category: "Fine dining", featuredRank: 3,
    identitySource: "https://www.farmlore.in/" },
  "node/2189204878": { name: "Windmills Craftworks · Whitefield", address: "331, Road 5B, EPIP Zone, Whitefield, Bengaluru", aliases: "Windmills Craftworks", category: "Well-known", featuredRank: 4,
    identitySource: "https://windmills-india.com/" },
  "node/1923665125": { name: "Toit · Indiranagar", address: "100 Feet Road, Indiranagar, Bengaluru", aliases: "Toit Brewpub", category: "Well-known", featuredRank: 5,
    identitySource: "https://toit.in/" },
  "node/5762989003": { name: "Burma Burma · Indiranagar", address: "12th Main Road, Indiranagar, Bengaluru", aliases: "Burma Burma Restaurant Tea Room", category: "Well-known", featuredRank: 6,
    identitySource: "https://www.burmaburma.in/" },
  "node/1851612837": { name: "Toscano · UB City", address: "UB City, Vittal Mallya Road, Bengaluru", aliases: "Toscano Italian", category: "Well-known", featuredRank: 7,
    identitySource: "https://www.toscano.co.in/" },
};

const pubSource = "https://1522thepub.com/reach-us/";
const breakfastSource = "https://154breakfast.club/";
const indianSource = "https://1947restaurants.in/";
// Distinct branches are intentional. Do not merge them by chain name.
const branchCorrections: [string, string, string, string][] = [
  ["node/11303671252", "1522 The Pub · JP Nagar", "613, Outer Ring Road, JP Nagar 6th Phase, Bengaluru", pubSource],
  ["node/3782893189", "1522 The Pub · Koramangala", "80 Feet Road, Koramangala, Bengaluru", pubSource],
  ["node/13428525785", "1522 The Pub · Sahakar Nagar", "Bellary Road, Sahakar Nagar, Bengaluru", pubSource],
  ["node/10302647647", "1522 The Pub · New BEL Road", "23, New BEL Road, Mathikere, Bengaluru", pubSource],
  ["node/10944076080", "1522 The Pub · RR Nagar", "466/B, 15th Cross Road, Rajarajeshwari Nagar, Bengaluru", pubSource],
  ["node/10016136908", "1522 The Pub · Residency Road", "65, Field Marshal Cariappa Road, Residency Road, Bengaluru", pubSource],
  ["node/4444197722", "1522 The Pub · Malleshwaram", "17th Cross Road, Subramanyanagar, Malleshwaram, Bengaluru", pubSource],
  ["node/14167036016", "1522 The Pub · Kammanahalli", "30, CMR Main Road, HRBR Layout, Kalyan Nagar, Bengaluru", pubSource],
  ["node/11293484209", "154 Breakfast Club · JP Nagar", "688, 15th Cross, JP Nagar 2nd Phase, Bengaluru", breakfastSource],
  ["node/13013588706", "154 Breakfast Club · RR Nagar", "248/1, 80 Feet Road, Rajarajeshwari Nagar, Bengaluru", breakfastSource],
  ["node/10728008693", "154 Breakfast Club · Koramangala", "440, 8th Main Road, Koramangala 4th Block, Bengaluru", breakfastSource],
  ["node/11303751506", "1947 Restaurant · JP Nagar", "JP Nagar, Bengaluru", indianSource],
  ["node/1474091077", "1947 Restaurant · Jayanagar", "Jayanagar, Bengaluru", indianSource],
  ["node/1979075210", "1947 Restaurant · Rajajinagar", "Industrial Town, West of Chord Road, Rajajinagar, Bengaluru", indianSource],
  ["node/12532000094", "1947 Restaurant · Hennur", "Hennur Main Road, Kothanur, Bengaluru", indianSource],
  ["node/4444989839", "1947 Restaurant · Malleshwaram", "15th Cross Road, Malleshwaram, Bengaluru", indianSource],
];
for (const [id, name, address, identitySource] of branchCorrections) {
  restaurantDirectory[id] = { name, address, identitySource, aliases: name.replace(/ · /g, " ") };
}

// Official website images remain hosted by their publishers. Source links are
// visible in the UI; no open license or photographer attribution is invented.
restaurantDirectory["node/3761073062"].photo = {
  url: "https://cdn.sanity.io/images/ocl5w36p/ihcl_prod/779792c5049c784501cead64f056dd43f675e2d2-3360x1240.jpg?w=980",
  sourceUrl: restaurantDirectory["node/3761073062"].identitySource!, provider: "Photo: Vivanta / Karavalli", authors: [],
};
restaurantDirectory["node/10591455581"].photo = {
  url: "https://lupa.co.in/wp-content/uploads/2023/11/courtyard-1-768x361.webp",
  sourceUrl: "https://lupa.co.in/space/", provider: "Photo: LUPA official website", authors: [],
};
restaurantDirectory["node/9177560311"].photo = {
  url: "https://static.wixstatic.com/media/912ec9_0e2334cc0819498f89842c29478132cf%7Emv2.jpg/v1/fit/w_2500,h_1330,al_c/912ec9_0e2334cc0819498f89842c29478132cf%7Emv2.jpg",
  sourceUrl: "https://www.farmlore.in/", provider: "Food photo: FarmLore official website", authors: [],
  description: "Dish photographed for FarmLore's official website",
};
