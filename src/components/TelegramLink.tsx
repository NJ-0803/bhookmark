import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

type Request = (path: string, opts?: RequestInit) => Promise<Response>;
type State =
  | { kind: "loading" } | { kind: "hidden" } | { kind: "idle" }
  | { kind: "started"; url: string; expiresAt: number }
  | { kind: "pending"; sender: string } | { kind: "linked"; sender: string };
const tgId = (sender: string) => sender.replace(/^tg:/, "");

/** Telegram account linking. Renders nothing unless the server has Telegram turned on. */
export default function TelegramLink({ request = api }: { request?: Request }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [bot, setBot] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const config = await request("/telegram/link/config");
    if (!config.ok) return setState({ kind: "hidden" });
    setBot((await config.json()).botUsername);
    const status = await request("/telegram/link/status");
    if (!status.ok) return setState({ kind: "hidden" });
    const s = await status.json() as { pendingSender: string | null; linkedSender: string | null };
    setState((prev) => s.linkedSender ? { kind: "linked", sender: s.linkedSender } : s.pendingSender ? { kind: "pending", sender: s.pendingSender }
      // An open link stays open until the person presses Start or it expires; polling must not reset it.
      : prev.kind === "started" && prev.expiresAt > Date.now() ? prev : { kind: "idle" });
  }, [request]);
  useEffect(() => { void refresh().catch(() => setState({ kind: "hidden" })); }, [refresh]);
  // While a link is open, check whether the person has pressed Start in Telegram.
  useEffect(() => {
    if (state.kind !== "started") return;
    const timer = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [state.kind, refresh]);

  async function act(run: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await run(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Try again."); } finally { setBusy(false); }
  }
  const start = () => act(async () => {
    const res = await request("/telegram/link/start", { method: "POST" });
    if (!res.ok) throw new Error("Couldn't start linking. Sign in again, then retry.");
    const { command, expiresAt } = await res.json() as { command: string; expiresAt: number };
    setState({ kind: "started", url: `https://t.me/${bot}?start=${command.replace(/^LINK /, "")}`, expiresAt });
  });
  const confirm = (sender: string) => act(async () => {
    const res = await request("/telegram/link/confirm", { method: "POST", body: JSON.stringify({ sender, confirmation: code.trim().toLowerCase() }) });
    if (!res.ok) throw new Error("That code didn't match or has expired. Check the message from the bot, or start again.");
    setCode(""); await refresh();
  });
  const unlink = () => act(async () => {
    const res = await request("/telegram/link", { method: "DELETE" });
    if (!res.ok) throw new Error("Couldn't unlink. Try again.");
    await refresh();
  });

  if (state.kind === "loading" || state.kind === "hidden") return null;
  return <section aria-labelledby="telegram-link-title" className="mt-8 mb-4 p-5 bg-surface border border-line rounded-3xl">
    <h2 id="telegram-link-title" className="font-display text-[20px] mb-2">Save by Telegram</h2>
    {state.kind === "idle" && <>
      <p className="text-muted text-sm leading-relaxed mb-4">Message the Bhookmark bot to save and rate dishes, like "Had butter chicken at Toit Indiranagar, 9/10". Link your account first.</p>
      <button disabled={busy} onClick={start} className="primary-button w-full">{busy ? "Starting…" : "Link Telegram"}</button></>}
    {state.kind === "started" && <>
      <p className="text-muted text-sm leading-relaxed mb-4">Open Telegram and press Start. This link works once and expires in 10 minutes.</p>
      <a href={state.url} target="_blank" rel="noopener noreferrer" className="primary-button w-full block text-center">Open Telegram</a>
      <p className="text-muted text-[13px] mt-3" role="status">Waiting for you to press Start…</p></>}
    {state.kind === "pending" && <>
      <p className="text-muted text-sm leading-relaxed mb-4">The bot saw Telegram account <strong className="text-ink">{tgId(state.sender)}</strong>. If that is you, enter the confirmation code the bot sent back. If you don't recognise it, don't continue.</p>
      <label className="field-label">Confirmation code<input value={code} onChange={(e) => setCode(e.target.value)} inputMode="text" autoComplete="off" spellCheck={false} maxLength={48} className="field" /></label>
      <button disabled={busy || code.trim().length !== 48} onClick={() => confirm(state.sender)} className="primary-button w-full mt-4">{busy ? "Confirming…" : "Confirm and link"}</button></>}
    {state.kind === "linked" && <>
      <p className="text-muted text-sm leading-relaxed mb-4">Linked to Telegram account <strong className="text-ink">{tgId(state.sender)}</strong>. Messages from it can read and change your saved food. Send STOP to the bot or unlink here.</p>
      <a href={`https://t.me/${bot}`} target="_blank" rel="noopener noreferrer" className="primary-button w-full block text-center mb-3">Return to Telegram</a>
      <p className="text-muted text-[13px] mb-4">Then send any message to the bot to see your menu.</p>
      <button disabled={busy} onClick={unlink} className="secondary-button w-full">{busy ? "Unlinking…" : "Unlink Telegram"}</button></>}
    {error && <p role="alert" className="text-bad text-sm mt-4">{error}</p>}
  </section>;
}
