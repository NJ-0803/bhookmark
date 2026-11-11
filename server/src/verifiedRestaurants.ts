import type { RestaurantPhoto } from "./restaurants";

// Editorial order, not ratings. Identity and photo provenance are reviewed per
// OSM branch. Never reuse these images for another branch with a similar name.
export const verifiedRestaurants: Record<string, { name: string; address: string; aliases: string; photo: RestaurantPhoto }> = {
  "node/4447135317": {
    name: "Vidyarthi Bhavan", address: "Gandhi Bazaar, Basavanagudi, Bengaluru", aliases: "Vidyarthi Bhavan",
    photo: { url: "/restaurant-photos/vidyarthi-bhavan.jpg", sourceUrl: "https://commons.wikimedia.org/wiki/File:VidyarthiBhavanEntrance.jpg", provider: "Wikimedia Commons", year: 2007,
      authors: [{ name: "Sarvagnya", url: "https://commons.wikimedia.org/wiki/User:Sarvagnya" }], license: { name: "CC BY 2.5", url: "https://creativecommons.org/licenses/by/2.5/" } },
  },
  "node/429833271": {
    name: "MTR · Lalbagh Road", address: "Lalbagh Road, Bengaluru", aliases: "Mavalli Tiffin Rooms MTR",
    photo: { url: "/restaurant-photos/mtr-lalbagh.jpg", sourceUrl: "https://commons.wikimedia.org/wiki/File:Mavalli_Tiffin_Room_(1),_Lalbagh_Road,_Bengaluru.jpg", provider: "Wikimedia Commons", year: 2021,
      authors: [{ name: "Gpkp", url: "https://commons.wikimedia.org/wiki/User:Gpkp" }], license: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" } },
  },
  "node/349291886": {
    name: "Koshy's", address: "St. Mark's Road, Bengaluru", aliases: "Koshys Koshy's",
    photo: { url: "/restaurant-photos/koshys.jpg", sourceUrl: "https://commons.wikimedia.org/wiki/File:Koshys.jpg", provider: "Wikimedia Commons", year: 2012,
      authors: [{ name: "Atr hugo", url: "https://commons.wikimedia.org/wiki/User:Atr_hugo" }], license: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" } },
  },
  "node/1289833985": {
    name: "CTR · Shri Sagar", address: "Malleshwaram, Bengaluru", aliases: "Central Tiffin Room Rooms CTR Shri Shree Sagar",
    photo: { url: "/restaurant-photos/ctr.webp", sourceUrl: "https://commons.wikimedia.org/wiki/File:SriSagara_Hotel_or_CTR_or_Central_Tiffin_Rooms,_Malleshwaram,_Bengaluru.webp", provider: "Wikimedia Commons", year: 2020,
      authors: [{ name: "Mallikarjunasj", url: "https://commons.wikimedia.org/wiki/User:Mallikarjunasj" }], license: { name: "CC0", url: "https://creativecommons.org/publicdomain/zero/1.0/" } },
  },
  "node/428845624": {
    name: "Hard Rock Cafe · St. Mark's Road", address: "St. Mark's Road, Bengaluru", aliases: "Hard Rock Cafe",
    photo: { url: "/restaurant-photos/hard-rock-cafe.jpg", sourceUrl: "https://commons.wikimedia.org/wiki/File:Hard_Rock_Cafe,_Bengaluru.JPG", provider: "Wikimedia Commons", year: 2012,
      authors: [{ name: "Gafoor", url: "https://commons.wikimedia.org/wiki/User:Gafoor" }], license: { name: "CC BY-SA 3.0", url: "https://creativecommons.org/licenses/by-sa/3.0/" } },
  },
};
