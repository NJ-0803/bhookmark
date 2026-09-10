export interface Venue {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  photo: string;
  photoIsVerified: boolean; // true only where the photo is confirmed to be this exact place
  serves: { category: string; subtype: string; dishName: string; baseScore: number }[];
}

// Approximate real coordinates for these Bangalore neighborhoods. Good
// enough for a same-neighborhood "within Xkm" demo — not surveyed
// storefront-precise locations.
export const VENUES: Venue[] = [
  {
    id: "v-ctr",
    name: "CTR (Shri Sagar)",
    area: "Malleshwaram",
    lat: 12.9941,
    lng: 77.5709,
    photo: "/venues/ctr.jpg",
    photoIsVerified: true,
    serves: [{ category: "Dosa & Idli", subtype: "Benne Dosa", dishName: "Benne Masala Dosa", baseScore: 9.1 }],
  },
  {
    id: "v-vidyarthi",
    name: "Vidyarthi Bhavan",
    area: "Basavanagudi",
    lat: 12.9422,
    lng: 77.576,
    photo: "/venues/vidyarthi-bhavan.jpg",
    photoIsVerified: true,
    serves: [
      { category: "Dosa & Idli", subtype: "Plain / Set Dosa", dishName: "Set Dosa (3pc)", baseScore: 8.8 },
      { category: "Coffee", subtype: "Strong / Degree", dishName: "Degree Coffee", baseScore: 9.0 },
    ],
  },
  {
    id: "v-brahmins",
    name: "Brahmin's Coffee Bar",
    area: "Shankarapuram",
    lat: 12.95,
    lng: 77.57,
    photo: "/venues/generic-bangalore.jpg",
    photoIsVerified: false,
    serves: [{ category: "Dosa & Idli", subtype: "Idli-Vada", dishName: "Idli Vada Combo", baseScore: 8.5 }],
  },
  {
    id: "v-meghana",
    name: "Meghana Foods",
    area: "Residency Road",
    lat: 12.9716,
    lng: 77.6083,
    photo: "/venues/generic-bangalore.jpg",
    photoIsVerified: false,
    serves: [{ category: "Biryani", subtype: "Chicken", dishName: "Chicken Dum Biryani", baseScore: 8.9 }],
  },
  {
    id: "v-empire",
    name: "Empire Restaurant",
    area: "Koramangala",
    lat: 12.9352,
    lng: 77.6245,
    photo: "/venues/generic-bangalore.jpg",
    photoIsVerified: false,
    serves: [{ category: "Biryani", subtype: "Mutton", dishName: "Mutton Biryani", baseScore: 8.3 }],
  },
  {
    id: "v-nagarjuna",
    name: "Nagarjuna",
    area: "Residency Road",
    lat: 12.9718,
    lng: 77.609,
    photo: "/venues/generic-bangalore.jpg",
    photoIsVerified: false,
    serves: [{ category: "Biryani", subtype: "Veg", dishName: "Veg Biryani", baseScore: 7.9 }],
  },
  {
    id: "v-thirdwave",
    name: "Third Wave Coffee",
    area: "Indiranagar",
    lat: 12.9719,
    lng: 77.6412,
    photo: "/venues/generic-bangalore.jpg",
    photoIsVerified: false,
    serves: [{ category: "Coffee", subtype: "Cold Filter Coffee", dishName: "Cold Filter Coffee", baseScore: 8.1 }],
  },
  {
    id: "v-truffles",
    name: "Truffles",
    area: "Koramangala",
    lat: 12.9345,
    lng: 77.6265,
    photo: "/venues/generic-bangalore.jpg",
    photoIsVerified: false,
    serves: [{ category: "Burger", subtype: "Chicken", dishName: "Peri Peri Chicken Burger", baseScore: 8.4 }],
  },
  {
    id: "v-airlines",
    name: "Airlines Hotel",
    area: "Lavelle Road",
    lat: 12.9707,
    lng: 77.5966,
    photo: "/venues/generic-bangalore.jpg",
    photoIsVerified: false,
    serves: [{ category: "Burger", subtype: "Veg", dishName: "Farmer's Veg Burger", baseScore: 7.6 }],
  },
  // A couple of extra burger spots so "near me -> burgers" has more than one
  // real result to rank, since that's the exact scenario asked for.
  {
    id: "v-toit",
    name: "Toit Brewpub",
    area: "Indiranagar",
    lat: 12.9783,
    lng: 77.6408,
    photo: "/venues/generic-bangalore.jpg",
    photoIsVerified: false,
    serves: [{ category: "Burger", subtype: "Chicken", dishName: "Smoked Chicken Burger", baseScore: 8.2 }],
  },
  {
    id: "v-koshys",
    name: "Koshy's",
    area: "St. Mark's Road",
    lat: 12.9744,
    lng: 77.6058,
    photo: "/venues/generic-bangalore.jpg",
    photoIsVerified: false,
    serves: [{ category: "Burger", subtype: "Veg", dishName: "Classic Veg Burger", baseScore: 7.4 }],
  },
  {
    id: "v-toscano",
    name: "Toscano",
    area: "Indiranagar",
    lat: 12.9726,
    lng: 77.6413,
    photo: "/venues/generic-bangalore.jpg",
    photoIsVerified: false,
    serves: [{ category: "Pizza", subtype: "Veg", dishName: "Margherita Pizza", baseScore: 8.5 }],
  },
  {
    id: "v-fava",
    name: "Fava",
    area: "Koramangala",
    lat: 12.9351,
    lng: 77.6269,
    photo: "/venues/generic-bangalore.jpg",
    photoIsVerified: false,
    serves: [{ category: "Pizza", subtype: "Non-veg", dishName: "Pepperoni Pizza", baseScore: 8.2 }],
  },
];

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
