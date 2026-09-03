import { useState } from "react";

// Brief section 1.6: every score, recommendation, or verification badge
// needs a visible "why" affordance instead of bare, unexplained numbers.
export default function WhyThis({ title = "How this is calculated", body }: { title?: string; body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-accent text-[11px] font-medium underline underline-offset-2"
      >
        {open ? "Hide" : title}
      </button>
      {open && <p className="text-faint text-xs leading-snug mt-1.5">{body}</p>}
    </div>
  );
}
