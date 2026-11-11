import { useMemo, useState } from "react";
import type { Bookmark } from "../wishlist";

export default function Saved({ bookmarks, loading, error, onRetry, onEdit, onRemove, onAdd }: {
  bookmarks: Bookmark[]; loading: boolean; error: string | null; onRetry: () => void;
  onEdit: (b: Bookmark) => void; onRemove: (b: Bookmark) => Promise<void>; onAdd: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "want" | "tried">("all");
  const groups = useMemo(() => {
    const list = bookmarks.filter((b) => (filter === "all" || (filter === "tried" ? b.tried : !b.tried)) && `${b.name} ${b.restaurantName} ${b.address} ${b.note}`.toLowerCase().includes(query.toLowerCase()));
    const map = new Map<string, Bookmark[]>();
    for (const b of list) map.set(b.restaurantId, [...(map.get(b.restaurantId) ?? []), b]);
    return [...map.values()];
  }, [bookmarks, filter, query]);
  return <div className="px-5 pt-8 pb-32 max-w-[720px] mx-auto">
    <p className="text-[13px] text-rose mb-2">Your private food wishlist</p><h1 className="font-display text-[30px] font-medium">My Bhookmarks</h1><p className="text-muted text-[15px] mt-2 mb-6">Every dish has a place. Keep yours together.</p>
    <button onClick={onAdd} className="primary-button mb-6 w-full">+ Save a food item</button>
    <input aria-label="Search saved dishes and notes" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search dishes, restaurants or notes" className="field !mt-0 mb-4" />
    <div className="flex gap-2 mb-6">{([['all', 'All'], ['want', 'Want to try'], ['tried', 'Tried']] as const).map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)} className={`px-4 min-h-11 rounded-full border text-[14px] ${filter === id ? "bg-accentDim border-accent text-rose" : "border-line text-muted"}`}>{label}</button>)}</div>
    {error && <div role="alert" className="text-bad border border-bad/40 rounded-xl p-4 mb-5 text-sm">{error} <button onClick={onRetry} className="underline min-h-11 ml-2">Try again</button></div>}
    {loading ? <p role="status" className="text-muted py-10 text-center">Loading your saved food…</p> : !groups.length && !error ? <div className="border border-dashed border-line rounded-card px-5 py-12 text-center"><h2 className="dish-name text-[28px] mb-3">{bookmarks.length ? "No matching bhookmarks." : "Your next great meal starts here."}</h2><p className="text-muted text-sm">{bookmarks.length ? "Try another search or filter." : "Find a restaurant and save the food you want to try."}</p></div> : <div className="flex flex-col gap-6">
      {groups.map((items) => <section key={items[0].restaurantId} className="bg-surface border border-line rounded-card overflow-hidden"><div className="p-5 border-b border-line"><h2 className="dish-name text-[28px]">{items[0].restaurantName}</h2><p className="text-muted text-[13px] mt-2">{items[0].address}</p></div><ul className="divide-y divide-line">{items.map((b) => <SavedItem key={b.id} bookmark={b} onEdit={onEdit} onRemove={onRemove} />)}</ul></section>)}
    </div>}
  </div>;
}

function SavedItem({ bookmark: b, onEdit, onRemove }: { bookmark: Bookmark; onEdit: (b: Bookmark) => void; onRemove: (b: Bookmark) => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <li className="p-5"><div className="flex items-start justify-between gap-4"><h3 className="dish-name text-[25px]">{b.name}</h3><span className="text-[12px] text-rose bg-accentDim rounded-full px-3 py-1 whitespace-nowrap">{b.tried ? "Tried" : "Want to try"}</span></div>
    {b.note && <p className="text-[14px] text-muted mt-3 whitespace-pre-wrap break-words">{b.note}</p>}
    <p className="text-[13px] mt-3 text-ink">{b.rating === null ? "Not rated" : `Your rating: ${b.rating.toFixed(1)} / 10`}</p>
    {b.referenceUrl && <a href={b.referenceUrl} target="_blank" rel="noreferrer" className="block text-rose text-[13px] underline mt-3 min-h-11 py-3">View saved reference ↗</a>}
    <div className="flex flex-wrap gap-3 mt-4"><button onClick={() => onEdit(b)} className="secondary-button">{b.tried ? "Edit notes & rating" : "Edit / mark tried"}</button><button onClick={() => setConfirm(!confirm)} disabled={pending} className="text-muted text-sm min-h-11 px-3">Remove</button></div>
    {confirm && <div className="bg-surface2 rounded-xl p-4 mt-3 text-sm"><p>Remove {b.name} from your saved food?</p><div className="flex gap-4 mt-2"><button disabled={pending} onClick={async () => { setPending(true); setError(null); try { await onRemove(b); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't remove this dish."); } finally { setPending(false); } }} className="text-bad min-h-11">{pending ? "Removing…" : "Yes, remove"}</button><button onClick={() => setConfirm(false)} disabled={pending} className="min-h-11">Keep it</button></div></div>}
    {error && <p role="alert" className="text-bad text-sm mt-3">{error}</p>}
  </li>;
}
