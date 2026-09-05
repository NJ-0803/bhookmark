import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";
import { cloneList, createList, getListsFeed, type DishList } from "../api";
import { haptic } from "../haptics";
import BottomSheet from "../components/BottomSheet";

const ACCENTS = ["bg-amber-400 text-amber-950", "bg-orange-600 text-orange-50", "bg-amber-800 text-amber-50", "bg-rose-500 text-rose-50"];

export default function RemixableLists() {
  const [reacted, setReacted] = useState<Set<string>>(new Set());
  const [lists, setLists] = useState<DishList[] | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [dishName, setDishName] = useState("");
  const [venue, setVenue] = useState("");
  const [items, setItems] = useState<{ dishName: string; venue: string }[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    getListsFeed().then((r) => r.ok && setLists(r.lists));
  }

  function toggle(id: string) {
    setReacted((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleClone(id: string) {
    setCloning(id);
    const res = await cloneList(id);
    setCloning(null);
    if (res.ok) {
      haptic("success");
      refresh();
    }
  }

  function addItem() {
    if (!dishName.trim() || !venue.trim()) return;
    setItems((prev) => [...prev, { dishName: dishName.trim(), venue: venue.trim() }]);
    setDishName("");
    setVenue("");
  }

  async function submitCreate() {
    if (!title.trim() || items.length === 0) return;
    setCreating(true);
    const res = await createList(title.trim(), items);
    setCreating(false);
    if (res.ok) {
      haptic("success");
      setShowCreate(false);
      setTitle("");
      setItems([]);
      refresh();
    }
  }

  return (
    <div className="px-5 pt-6 pb-32">
      <p className="text-muted text-sm mb-5">Clone a list, reorder it your way, or add one counter-pick — the list stays theirs, your remix is yours.</p>

      <div className="flex flex-col gap-3 mb-4">
        {lists === null ? (
          <p className="text-faint text-sm text-center py-6">Loading lists…</p>
        ) : lists.length === 0 ? (
          <div className="border border-dashed border-line rounded-card px-6 py-8 text-center">
            <p className="text-muted text-sm">No lists yet — be the first to start one.</p>
          </div>
        ) : (
          lists.map((l, i) => {
            const accent = ACCENTS[i % ACCENTS.length];
            return (
              <motion.div
                key={l.id}
                initial={{ opacity: 0, y: 20, scale: 0.97 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, margin: "-40px" }}
                whileTap={{ scale: 0.98 }}
                transition={{ ...LIQUID_SPRING, delay: Math.min(i, 4) * 0.05 }}
                className="relative bg-surface border border-line rounded-card p-4 pl-5 overflow-hidden"
              >
                <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${accent}`} />
                <div className="flex items-start justify-between gap-2 mb-0.5">
                  <div className="font-display font-bold text-base">{l.title}</div>
                  <span className={`shrink-0 font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full tabular ${accent}`}>{l.clones} clones</span>
                </div>
                {l.parentListId && <div className="text-faint text-[10px] mb-1">remixed from another list</div>}
                <ul className="flex flex-col gap-1 mb-3">
                  {l.items.map((item, j) => (
                    <li key={j} className="text-sm text-ink/85">· {item.dishName} · {item.venue}</li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <motion.button
                    whileTap={TAP_SCALE}
                    transition={LIQUID_SPRING}
                    onClick={() => handleClone(l.id)}
                    disabled={cloning === l.id}
                    className="flex-1 gradient-primary text-white text-xs font-semibold rounded-lg py-2 disabled:opacity-60"
                  >
                    {cloning === l.id ? "Cloning…" : "Clone this list"}
                  </motion.button>
                  <motion.button
                    whileTap={TAP_SCALE}
                    transition={LIQUID_SPRING}
                    onClick={() => toggle(l.id)}
                    className={`px-3 rounded-lg text-xs font-medium border ${reacted.has(l.id) ? "bg-accentDim text-accent border-accent/40" : "bg-surface2 border-line text-muted"}`}
                  >
                    + Counter-pick
                  </motion.button>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      <button
        onClick={() => setShowCreate(true)}
        className="w-full bg-surface border border-dashed border-line rounded-card py-3.5 text-sm font-medium text-muted"
      >
        + Start a list
      </button>

      <BottomSheet open={showCreate} onClose={() => setShowCreate(false)} title="Start a list">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title, e.g. Best rainy-day comfort food"
          aria-label="List title"
          className="w-full bg-surface2 border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent mb-4"
        />
        {items.length > 0 && (
          <ul className="flex flex-col gap-1 mb-3">
            {items.map((it, i) => (
              <li key={i} className="text-sm text-ink/85">· {it.dishName} · {it.venue}</li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 mb-2">
          <input
            value={dishName}
            onChange={(e) => setDishName(e.target.value)}
            placeholder="Dish"
            aria-label="Dish name"
            className="flex-1 bg-surface2 border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="Venue"
            aria-label="Venue"
            className="flex-1 bg-surface2 border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <button onClick={addItem} disabled={!dishName.trim() || !venue.trim()} className="text-accent text-xs font-medium mb-4 disabled:opacity-40">
          + add to list
        </button>
        <motion.button
          whileTap={TAP_SCALE}
          onClick={submitCreate}
          disabled={creating || !title.trim() || items.length === 0}
          className="w-full gradient-primary text-white font-semibold rounded-xl py-3 disabled:opacity-40"
        >
          Publish list
        </motion.button>
      </BottomSheet>
    </div>
  );
}
