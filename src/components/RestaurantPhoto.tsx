import { useState } from "react";
import type { Restaurant } from "../wishlist";

export default function RestaurantPhoto({ restaurant, index = 0, className = "" }: { restaurant: Restaurant; index?: number; className?: string }) {
  const photo = restaurant.photos[index];
  const [failed, setFailed] = useState(false);
  return <div className={`relative overflow-hidden bg-surface2 ${className}`}>
    {photo && !failed ? <>
      <img src={photo.url} alt={`${restaurant.name}, restaurant photo ${index + 1}`} loading="lazy" className="w-full h-full object-cover" onError={() => setFailed(true)} />
      <div className="absolute bottom-0 inset-x-0 bg-black/75 text-white px-3 py-2 text-[11px] flex flex-wrap gap-x-2">
        <a href={photo.sourceUrl} target="_blank" rel="noreferrer" className="underline">View photo on Google Maps</a>
        {photo.authors.map((a, i) => <a key={i} href={a.url} target="_blank" rel="noreferrer" className="underline">Photo: {a.name}</a>)}
      </div>
    </> : <div className="h-full min-h-36 flex flex-col items-center justify-center text-faint gap-3 p-5">
      <svg viewBox="0 0 48 48" className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M9 22v20h30V22M6 22l5-15h26l5 15M6 22q4 8 9 0 4 8 9 0 4 8 9 0 4 8 9 0M20 42V29h9v13" /></svg>
      <span className="text-[13px]">Restaurant photo unavailable</span>
    </div>}
  </div>;
}
