import type { OverlayDish } from '../components/CardOverlay';

// Four entries from the web app's static catalog (src/data/dishes.ts) with
// their existing photos, for exercising the card overlay in MotionLab. Not a
// data source for the product screens, which use the API.
export const LAB_DISHES: OverlayDish[] = [
  {
    id: 'd1',
    name: 'Benne Masala Dosa',
    venue: 'CTR (Shri Sagar)',
    area: 'Malleshwaram',
    category: 'Dosa & Idli',
    subtype: 'Benne Dosa',
    photo: require('../../assets/lab/benne-masala-dosa.jpg'),
  },
  {
    id: 'd4',
    name: 'Chicken Dum Biryani',
    venue: 'Meghana Foods',
    area: 'Residency Road',
    category: 'Biryani',
    subtype: 'Chicken',
    photo: require('../../assets/lab/chicken-dum-biryani.jpg'),
  },
  {
    id: 'd8',
    name: 'Cold Filter Coffee',
    venue: 'Third Wave Coffee',
    area: 'Indiranagar',
    category: 'Coffee',
    subtype: 'Cold Coffee',
    photo: require('../../assets/lab/cold-filter-coffee.jpg'),
  },
  {
    id: 'd11',
    name: 'Margherita Pizza',
    venue: 'Toscano',
    area: 'Indiranagar',
    category: 'Pizza',
    subtype: 'Veg',
    photo: require('../../assets/lab/margherita-pizza.jpg'),
  },
];
