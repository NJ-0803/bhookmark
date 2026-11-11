import { useState } from "react";
import type { Restaurant } from "../wishlist";

export default function RestaurantPhoto({ restaurant, index = 0, className = "" }: { restaurant: Restaurant; index?: number; className?: string }) {
  const photo = restaurant.photos[index];
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // Missing or failed photos don't reserve an empty image-sized box.
  if (!photo || failedUrl === photo.url) return null;
  return <figure>
    <div className={`relative overflow-hidden bg-surface2 ${className}`}>
      <img src={photo.url} alt={photo.description || `${restaurant.name}, restaurant photo${photo.year ? ` from ${photo.year}` : ` ${index + 1}`}`} loading="lazy" className="w-full h-full object-cover" onError={() => setFailedUrl(photo.url)} />
    </div>
    <figcaption className="text-faint px-4 py-2 text-[10px] leading-relaxed flex flex-wrap gap-x-2 border-b border-line">
      <a href={photo.sourceUrl} target="_blank" rel="noreferrer" className="underline">{photo.provider || "Google Maps"}{photo.year ? ` · ${photo.year}` : ""}</a>
      {photo.authors.map((a, i) => <a key={i} href={a.url} target="_blank" rel="noreferrer" className="underline">Photo: {a.name}</a>)}
      {photo.license && <a href={photo.license.url} target="_blank" rel="noreferrer" className="underline">{photo.license.name}</a>}
    </figcaption>
  </figure>;
}
