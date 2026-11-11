import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Bookmark, BookmarkInput, Restaurant } from "../wishlist";

export default function BookmarkForm({ restaurant, bookmark, onSave, onClose }: {
  restaurant: Restaurant | null; bookmark?: Bookmark; onSave: (input: BookmarkInput) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [venue, setVenue] = useState(bookmark?.restaurantName ?? restaurant?.name ?? "");
  const [address, setAddress] = useState(bookmark?.address ?? restaurant?.address ?? "");
  const [name, setName] = useState(bookmark?.name ?? "");
  const [note, setNote] = useState(bookmark?.note ?? "");
  const [referenceUrl, setReferenceUrl] = useState(bookmark?.referenceUrl ?? "");
  const [tried, setTried] = useState(bookmark?.tried ?? false);
  const [rating, setRating] = useState<number | null>(bookmark?.rating ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null); setSaving(true);
    try {
      let restaurantId = bookmark?.restaurantId ?? restaurant?.id;
      if (!restaurantId) {
        const normalized = `${venue.trim().toLowerCase().replace(/\s+/g, " ")}|${address.trim().toLowerCase().replace(/\s+/g, " ")}`;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
        restaurantId = `manual:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
      }
      await onSave({ restaurantId, restaurantName: venue.trim(), address: address.trim(), name: name.trim(), note, referenceUrl, tried, rating: tried ? rating : null });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save. Please try again."); }
    finally { setSaving(false); }
  }

  return createPortal(<dialog ref={dialog} onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }} aria-labelledby="save-title" className="bookmark-dialog">
    <div className="flex items-start justify-between gap-3 mb-5">
      <div><p className="text-rose text-[13px] mb-1">Your food wishlist</p><h2 id="save-title" className="font-display text-[24px]">{bookmark ? "Edit your bhookmark" : "Save something delicious"}</h2></div>
      <button type="button" onClick={onClose} disabled={saving} aria-label="Close save form" className="min-w-11 h-11 rounded-full border border-line">✕</button>
    </div>
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="field-label">Restaurant<input required maxLength={160} value={venue} onChange={(e) => setVenue(e.target.value)} readOnly={Boolean(restaurant || bookmark)} className="field" placeholder="Restaurant name" /></label>
      <label className="field-label">Branch / address<input required maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} readOnly={Boolean(restaurant || bookmark)} className="field" placeholder="Area and branch, Bengaluru" /></label>
      <label className="field-label">Food item<input autoFocus required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} readOnly={Boolean(bookmark)} className="field" placeholder="e.g. Truffle mushroom pizza" /></label>
      <label className="field-label">Notes <span className="text-faint">(optional)</span><textarea maxLength={2000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="field resize-y" placeholder="What caught your eye? What should you order?" /></label>
      <label className="field-label">Reference link <span className="text-faint">(optional)</span><input type="url" maxLength={2000} value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} className="field" placeholder="A reel, menu or food photo link" /></label>
      <label className="flex items-center gap-3 text-[15px] min-h-11"><input type="checkbox" checked={tried} onChange={(e) => { setTried(e.target.checked); if (!e.target.checked) setRating(null); }} className="w-5 h-5 accent-[rgb(var(--accent))]" />I've tried this dish</label>
      {tried && <label className="field-label">Your rating <span className="text-faint">(optional, out of 10)</span>
        <select aria-label="Your rating out of 10" value={rating ?? ""} onChange={(e) => setRating(e.target.value === "" ? null : Number(e.target.value))} className="field">
          <option value="">Not rated</option>{Array.from({ length: 21 }, (_, i) => i / 2).map((n) => <option key={n} value={n}>{n.toFixed(1)} / 10</option>)}
        </select>
      </label>}
      <p className="text-[13px] text-muted">Your saves, notes and ratings are private. You choose every rating.</p>
      {error && <p role="alert" className="text-bad text-sm">{error}</p>}
      <button disabled={saving || !venue.trim() || !address.trim() || !name.trim()} className="primary-button">{saving ? "Saving…" : bookmark ? "Save changes" : "Save food item"}</button>
    </form>
  </dialog>, document.body);
}
