import { useState } from "react";
import { clearSession, getSession, currentDeviceId, revokeSession } from "../api";
import { getThemePref, setThemePref, type ThemePref } from "../theme";

export default function Account({ onSignOut }: { onSignOut: () => void }) {
  const [theme, setTheme] = useState(getThemePref);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div className="px-5 pt-8 pb-32 max-w-[620px] mx-auto"><p className="text-rose text-[13px] mb-2">Bhookmark</p><h1 className="font-display text-[30px] mb-3">Your account</h1><p className="text-muted mb-7 break-words">{getSession()?.user.email || "Your private food wishlist"}</p>
    <label className="field-label">Appearance<select value={theme} onChange={(e) => { const value = e.target.value as ThemePref; setTheme(value); setThemePref(value); }} className="field"><option value="evening">Evening</option><option value="daylight">Daylight</option><option value="system">Match device</option></select></label>
    <p className="text-muted text-sm leading-relaxed mt-6 mb-6">Your saved dishes, notes and manually entered ratings belong to you. They aren't published as restaurant ratings.</p>
    {error && <p role="alert" className="text-bad text-sm mb-4">{error}</p>}
    <button disabled={busy} onClick={async () => { setBusy(true); setError(null); try { const id = currentDeviceId(); if (id) { const r = await revokeSession(id); if (!r.ok) throw new Error("Couldn't end your session. Try again."); } clearSession(); onSignOut(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't sign out."); } finally { setBusy(false); } }} className="secondary-button w-full">{busy ? "Signing out…" : "Sign out"}</button>
  </div>;
}
