import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";
import { cloneList, createList, getListsFeed, type DishList } from "../api";
import { haptic } from "../haptics";
import BottomSheet from "../components/BottomSheet";
import Reveal from "../components/Reveal";
import { DepthLayer, FloatCard } from "../components/CardStage";

export default function RemixableLists() {
  const [lists, setLists] = useState<DishList[] | null>(null);

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

  async function cloneAndRefresh(id: string): Promise<boolean> {
    const res = await cloneList(id);
    if (res.ok) {
      haptic("success");
      refresh();
    }
    return !!res.ok;
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
          lists.map((l, i) => (
            <Reveal key={l.id} delay={Math.min(i, 4) * 0.07}>
              <FloatCard
                id={`list-${l.id}`}
                label={l.title}
                className="bg-surface border border-line"
                contentClassName="relative p-4 pl-5"
                panel={() => <ListPanel list={l} onClone={cloneAndRefresh} />}
              >
                <span aria-hidden="true" className="absolute left-0 top-4 bottom-4 w-px bg-accent" />
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[15px] font-medium text-ink">{l.title}</div>
                  <span className="shrink-0 font-mono text-[10px] text-faint tabular mt-1">
                    {l.clones} clone{l.clones === 1 ? "" : "s"}
                  </span>
                </div>
                {l.parentListId && <div className="text-faint text-[10px] mt-0.5">remixed from another list</div>}
                <p className="text-muted text-xs mt-2 truncate">
                  {l.items
                    .slice(0, 3)
                    .map((item) => item.dishName)
                    .join(" · ")}
                  {l.items.length > 3 ? `  +${l.items.length - 3}` : ""}
                </p>
              </FloatCard>
            </Reveal>
          ))
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

function ListPanel({ list, onClone }: { list: DishList; onClone: (id: string) => Promise<boolean> }) {
  const [cloneState, setCloneState] = useState<"idle" | "cloning" | "done" | "error">("idle");
  const [counterPick, setCounterPick] = useState(false);

  async function clone() {
    setCloneState("cloning");
    setCloneState((await onClone(list.id)) ? "done" : "error");
  }

  return (
    <div className="p-5 pt-6">
      <DepthLayer depth={6}>
        <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint mb-2">
          {list.clones} clone{list.clones === 1 ? "" : "s"}
          {list.parentListId ? " · remixed" : ""}
        </p>
        <h2 className="font-display font-semibold text-[22px] leading-tight tracking-[-0.01em] text-ink pr-12">{list.title}</h2>
      </DepthLayer>

      <DepthLayer depth={10} className="mt-5">
        <ol className="flex flex-col">
          {list.items.map((item, j) => (
            <li key={j} className="flex items-baseline gap-3 py-2.5 border-b border-line last:border-b-0">
              <span className="font-mono text-[10px] text-faint tabular w-5 shrink-0">{String(j + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <span className="dish-name text-[15px] text-ink">{item.dishName}</span>
                <div className="text-faint text-xs mt-1">{item.venue}</div>
              </div>
            </li>
          ))}
        </ol>
      </DepthLayer>

      <DepthLayer depth={14} className="mt-6">
        <div className="flex gap-2">
          <motion.button
            whileTap={TAP_SCALE}
            transition={LIQUID_SPRING}
            onClick={clone}
            disabled={cloneState === "cloning" || cloneState === "done"}
            className="flex-1 bg-accent text-accentInk text-[13px] font-medium rounded-xl py-3 disabled:opacity-60"
          >
            {cloneState === "cloning" ? "Cloning…" : cloneState === "done" ? "Cloned to your lists" : "Clone this list"}
          </motion.button>
          <motion.button
            whileTap={TAP_SCALE}
            transition={LIQUID_SPRING}
            onClick={() => setCounterPick((v) => !v)}
            aria-pressed={counterPick}
            className={`px-4 rounded-xl text-[13px] border ${counterPick ? "bg-accentDim text-ink border-accent" : "border-line text-muted"}`}
          >
            Counter-pick
          </motion.button>
        </div>
        {cloneState === "error" && <p className="text-bad text-xs mt-2">Couldn't clone that list.</p>}
      </DepthLayer>
    </div>
  );
}
