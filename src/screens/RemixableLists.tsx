import { useState } from "react";

const SEED_LISTS = [
  { id: "l1", title: "Best late-night dosas under ₹150", author: "Aish", clones: 214, items: ["Set Dosa · Vidyarthi Bhavan", "Idli Vada · Brahmin's Coffee Bar"] },
  { id: "l2", title: "Dates that did not deserve dessert", author: "Rohan", clones: 89, items: ["Veg Biryani · Nagarjuna"] },
  { id: "l3", title: "Bangalore filter coffee starter pack", author: "Navtej", clones: 312, items: ["Degree Coffee · Vidyarthi Bhavan", "Cold Filter Coffee · Third Wave"] },
];

export default function RemixableLists() {
  const [reacted, setReacted] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setReacted((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="px-5 pt-6 pb-32">
      <p className="text-muted text-sm mb-5">Clone a list, reorder it your way, or add one counter-pick — the list stays theirs, your remix is yours.</p>
      <div className="flex flex-col gap-3">
        {SEED_LISTS.map((l) => (
          <div key={l.id} className="bg-surface border border-line rounded-card p-4">
            <div className="font-display font-bold text-base mb-0.5">{l.title}</div>
            <div className="text-faint text-xs mb-3">by {l.author} · {l.clones} clones</div>
            <ul className="flex flex-col gap-1 mb-3">
              {l.items.map((item) => (
                <li key={item} className="text-sm text-ink/85">· {item}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button className="flex-1 bg-accent text-accentInk text-xs font-semibold rounded-lg py-2">Clone this list</button>
              <button
                onClick={() => toggle(l.id)}
                className={`px-3 rounded-lg text-xs font-medium border ${reacted.has(l.id) ? "bg-accentDim text-accent border-accent/40" : "bg-surface2 border-line text-muted"}`}
              >
                + Counter-pick
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
