import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { getBookmarks, getSession, putBookmark, removeBookmark } from "./api";
import { CardStageProvider, StageShell, useCardStage } from "./components/CardStage";
import BookmarkForm from "./components/BookmarkForm";
import Explore from "./screens/Explore";
import Saved from "./screens/Saved";
import Account from "./screens/Account";
import Login from "./screens/Login";
import type { Bookmark, BookmarkInput, Restaurant } from "./wishlist";
import { LIQUID_SPRING } from "./motion";

type Tab = "explore" | "saved" | "account";
type Editor = { restaurant: Restaurant | null; bookmark?: Bookmark };

export default function App() { return <CardStageProvider><WishlistApp /></CardStageProvider>; }

function WishlistApp() {
  const [authed, setAuthed] = useState(() => Boolean(getSession()));
  const [tab, setTab] = useState<Tab>("explore");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [login, setLogin] = useState(false);
  const [notice, setNotice] = useState("");
  const { close } = useCardStage();
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (!getSession()) return;
    const current = ++generation.current;
    setLoading(true); setError(null);
    try { const items = await getBookmarks(); if (current === generation.current) setBookmarks(items); }
    catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Couldn't load your saved food."); }
    finally { if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { if (authed) { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); } }, [authed, load]);
  const signOut = useCallback(() => { generation.current++; setAuthed(false); setBookmarks([]); setEditor(null); setLoading(false); setError(null); setLogin(false); close(); setTab("explore"); }, [close]);
  useEffect(() => { window.addEventListener("bhookmark:session-expired", signOut); return () => window.removeEventListener("bhookmark:session-expired", signOut); }, [signOut]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 3500); return () => clearTimeout(timer); }, [notice]);

  function add(restaurant: Restaurant | null) { close(); setEditor({ restaurant }); if (!authed) setLogin(true); }
  async function save(input: BookmarkInput, id?: string) {
    if (!id && bookmarks.some((b) => b.restaurantId === input.restaurantId && b.name.trim().toLowerCase().replace(/\s+/g, " ") === input.name.trim().toLowerCase().replace(/\s+/g, " "))) {
      throw new Error("This dish is already saved here. Open My Bhookmarks to edit its notes or rating.");
    }
    const current = generation.current;
    const item = await putBookmark(input, id);
    if (current !== generation.current) return;
    generation.current++; setLoading(false); setError(null);
    setBookmarks((items) => [item, ...items.filter((b) => b.id !== item.id)].sort((a, b) => b.savedAt - a.savedAt));
    setNotice(`Saved ${item.name}`);
  }

  if (login) return <><button onClick={() => { setLogin(false); setEditor(null); }} className="secondary-button ml-5 mt-6">← Back to exploring</button><Login onSignedIn={() => { setAuthed(true); setLogin(false); }} /></>;

  return <div className="min-h-dvh">
    <StageShell><motion.main key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={LIQUID_SPRING}>
      {tab === "explore" && <Explore bookmarks={bookmarks} onSave={add} onManual={() => add(null)} />}
      {tab === "saved" && (authed ? <Saved bookmarks={bookmarks} loading={loading} error={error} onRetry={load} onEdit={(b) => setEditor({ restaurant: null, bookmark: b })} onRemove={async (b) => { await removeBookmark(b.id); generation.current++; setLoading(false); setBookmarks((items) => items.filter((x) => x.id !== b.id)); setNotice(`Removed ${b.name}`); }} onAdd={() => add(null)} /> : <SignInPrompt onSignIn={() => setLogin(true)} />)}
      {tab === "account" && (authed ? <Account onSignOut={signOut} /> : <SignInPrompt onSignIn={() => setLogin(true)} />)}
    </motion.main></StageShell>
    <nav aria-label="Main navigation" className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[460px] z-40 px-4 pt-2 bg-bg" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}><div className="grid grid-cols-3 p-2 bg-surface border border-line rounded-[26px] shadow-lift">
      {([['explore', 'Explore'], ['saved', 'My Bhookmarks'], ['account', 'Account']] as const).map(([id, label]) => <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => { close(); setTab(id); window.scrollTo({ top: 0 }); }} className={`flex flex-col items-center gap-1 min-h-14 py-2 rounded-2xl ${tab === id ? "bg-surface2 text-rose" : "text-faint"}`}><NavIcon tab={id} /><span className="text-[12px]">{label}</span></button>)}
    </div></nav>
    {authed && editor && <BookmarkForm key={editor.bookmark?.id ?? editor.restaurant?.id ?? "manual"} {...editor} onSave={(input) => save(input, editor.bookmark?.id)} onClose={() => setEditor(null)} />}
    <div aria-live="polite" role="status" className="fixed bottom-28 inset-x-0 z-[80] px-5 pointer-events-none flex justify-center">{notice && <p className="bg-ink text-bg rounded-full px-5 py-3 text-sm shadow-lift">{notice}</p>}</div>
  </div>;
}

function SignInPrompt({ onSignIn }: { onSignIn: () => void }) { return <div className="px-5 pt-16 pb-32 max-w-[620px] mx-auto"><p className="text-rose text-sm mb-3">Your private food wishlist</p><h1 className="font-display text-[30px] mb-4">Keep your next meal in mind.</h1><p className="text-muted mb-7">Sign in to save dishes at different restaurants, add notes and keep your own ratings.</p><button onClick={onSignIn} className="primary-button w-full">Sign in to save food</button></div>; }

function NavIcon({ tab }: { tab: Tab }) { return <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{tab === "explore" ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></> : tab === "saved" ? <path d="M6 4h12v16l-6-4-6 4z" /> : <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1-6 13-6 14 0" /></>}</svg>; }
