import { useEffect, useRef, useState } from "react";
import { getCoverage, getRestaurant, searchRestaurants } from "../api";
import { DepthLayer, FloatCard } from "../components/CardStage";
import RestaurantPhoto from "../components/RestaurantPhoto";
import type { Bookmark, Restaurant, SearchResult } from "../wishlist";

export default function Explore({ bookmarks, onSave, onManual }: { bookmarks: Bookmark[]; onSave: (restaurant: Restaurant) => void; onManual: () => void }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [coverage, setCoverage] = useState<Awaited<ReturnType<typeof getCoverage>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [catalogOnly, setCatalogOnly] = useState(false);
  const sequence = useRef(0);
  useEffect(() => { getCoverage().then(setCoverage).catch(() => {}); }, []);
  useEffect(() => {
    const current = ++sequence.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError(null); setResult(null);
      searchRestaurants(query, catalogOnly ? { source: "osm" } : undefined, controller.signal).then((r) => { if (current === sequence.current) setResult(r); })
        .catch((e) => { if (!controller.signal.aborted && current === sequence.current) setError(e instanceof Error ? e.message : "Couldn't load restaurants."); })
        .finally(() => { if (current === sequence.current) setLoading(false); });
    }, query ? 350 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, retry, catalogOnly]);

  async function loadMore() {
    if (!result || moreLoading) return;
    const current = sequence.current;
    setMoreLoading(true); setError(null);
    try {
      const next = await searchRestaurants(query, { source: result.source, offset: result.nextOffset ?? undefined, pageToken: result.nextPageToken ?? undefined });
      if (current === sequence.current) setResult({ ...next, restaurants: next.source === result.source ? [...new Map([...result.restaurants, ...next.restaurants].map((r) => [r.id, r])).values()] : next.restaurants });
    } catch (e) { if (current === sequence.current) setError(e instanceof Error ? e.message : "Couldn't load more restaurants."); }
    finally { setMoreLoading(false); }
  }

  return <div className="px-5 lg:px-10 pt-8 pb-32">
    <p className="text-rose text-[13px] mb-2">Bhookmark · Bengaluru</p>
    <h1 className="font-display text-[32px] lg:text-[44px] leading-tight font-medium max-w-[22ch]">Good food.<br /><span className="font-serif italic">Saved for another day.</span></h1>
    <p className="text-muted text-[15px] mt-3 mb-7 max-w-[48ch]">Find a restaurant. Save what you want to eat. Keep your own notes and ratings.</p>
    <label className="block relative mb-4"><span className="sr-only">Search Bangalore restaurants</span>
      <svg className="absolute left-4 top-4 w-5 h-5 text-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a restaurant or Bangalore neighbourhood" maxLength={120} className="field pl-12 pr-12 !mt-0 h-14" />
      {query && <button aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-1 top-1 w-12 h-12 text-muted">✕</button>}
    </label>
    <div className="flex items-start justify-between gap-4 mb-6 text-[13px] text-muted">
      <p>{result?.source === "google" ? "Live restaurant search · Google Maps" : "Bangalore restaurant catalog"}{coverage && result?.source !== "google" ? ` · ${coverage.catalogCount.toLocaleString()} places` : ""}</p>
      <button onClick={onManual} className="text-rose underline underline-offset-4 shrink-0 min-h-11 -mt-3">Add a missing place</button>
    </div>
    {coverage?.liveSearch && <div className="flex gap-2 mb-5" aria-label="Restaurant search source"><button onClick={() => setCatalogOnly(false)} aria-pressed={!catalogOnly} className={`secondary-button ${!catalogOnly ? "!border-accent !text-rose" : ""}`}>Live search</button><button onClick={() => setCatalogOnly(true)} aria-pressed={catalogOnly} className={`secondary-button ${catalogOnly ? "!border-accent !text-rose" : ""}`}>Bangalore catalog</button></div>}
    {result?.notice && <p role="status" className="text-muted text-sm border border-line rounded-xl p-4 mb-5">{result.notice}</p>}
    {error && <div role="alert" className="text-bad text-sm border border-bad/40 rounded-xl p-4 mb-5">{error} <button onClick={() => setRetry((n) => n + 1)} className="underline min-h-11 ml-2">Try again</button></div>}
    {loading ? <div role="status" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">{[1, 2, 3].map((n) => <div key={n} className="h-72 bg-surface border border-line rounded-card motion-safe:animate-pulse" />)}<span className="sr-only">Searching restaurants…</span></div> : <>
      {result && !result.restaurants.length && <div className="text-center border border-dashed border-line rounded-card px-5 py-12"><h2 className="dish-name text-[28px] mb-3">Couldn't find your spot?</h2><p className="text-muted text-sm mb-5">Try its branch or area, or add it yourself and save a food item.</p><button onClick={onManual} className="primary-button">Add restaurant & dish</button></div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {result?.restaurants.map((restaurant) => {
          const count = bookmarks.filter((b) => b.restaurantId === restaurant.id).length;
          return <FloatCard key={restaurant.id} id={restaurant.id} label={restaurant.name} wide className="bg-surface border border-line rounded-card overflow-hidden" panel={() => <RestaurantPanel restaurant={restaurant} onSave={onSave} />}>
            <RestaurantPhoto restaurant={restaurant} className="aspect-[16/10]" />
            <div className="p-4"><h2 className="dish-name text-[26px] line-clamp-2">{restaurant.name}</h2><p className="text-muted text-[13px] mt-2 line-clamp-2">{restaurant.address}</p><p className="text-rose text-[13px] mt-4">{count ? `${count} food item${count === 1 ? "" : "s"} saved` : "View restaurant & save a dish"} <span aria-hidden="true">↗</span></p></div>
          </FloatCard>;
        })}
      </div>
      {result && (result.nextPageToken || result.nextOffset !== null) && <button onClick={loadMore} disabled={moreLoading} className="secondary-button block mx-auto mt-7">{moreLoading ? "Loading…" : "More restaurants"}</button>}
    </>}
    <p className="text-faint text-[12px] mt-8">{result?.source === "google" ? "Restaurant details and photos: Google Maps. Availability varies by restaurant." : <>Restaurant data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap contributors</a>. Photos appear when a verified source is available.</>} Missing places can always be saved manually.</p>
  </div>;
}

function RestaurantPanel({ restaurant, onSave }: { restaurant: Restaurant; onSave: (r: Restaurant) => void }) {
  const [detail, setDetail] = useState(restaurant);
  useEffect(() => { let active = true; getRestaurant(restaurant.id).then((r) => { if (active) setDetail(r); }).catch(() => {}); return () => { active = false; }; }, [restaurant.id]);
  return <div className="lg:grid lg:grid-cols-2">
    <div><RestaurantPhoto restaurant={detail} className="aspect-[4/3] lg:aspect-square" />{detail.photos.length > 1 && <div className="grid grid-cols-2 gap-2 p-3">{detail.photos.slice(1).map((_p, i) => <RestaurantPhoto key={i} restaurant={detail} index={i + 1} className="aspect-[4/3] rounded-xl" />)}</div>}</div>
    <div className="p-6 lg:p-8"><DepthLayer depth={6}><p className="text-[13px] text-rose mb-2">Bengaluru · {detail.source === "google" ? "Google Maps" : "OpenStreetMap"}</p><h2 className="dish-name text-[36px] pr-8">{detail.name}</h2><p className="text-[15px] text-muted mt-3">{detail.address}</p></DepthLayer>
      <DepthLayer depth={10} className="mt-6"><button onClick={() => onSave(detail)} className="primary-button w-full">Save a food item here</button><a href={detail.mapsUrl} target="_blank" rel="noreferrer" className="secondary-button block text-center mt-3">Open in Maps ↗</a><p className="text-[13px] text-muted mt-6">Remember a dish you want to try. Once you've eaten it, add your own rating in My Bhookmarks.</p>
        {detail.attributions?.map((a, i) => <a key={i} href={a.providerUri} target="_blank" rel="noreferrer" className="block text-faint text-xs underline mt-3">{a.provider}</a>)}
      </DepthLayer>
    </div>
  </div>;
}
