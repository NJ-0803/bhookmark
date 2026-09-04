import { useState } from "react";
import { requestOtp, verifyOtp } from "../api";

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("+91");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRequestOtp() {
    setError(null);
    setLoading(true);
    try {
      const res = await requestOtp(phone);
      if (!res.ok) {
        setError(res.error ?? "Couldn't send a code. Try again.");
        return;
      }
      setDevOtp(res.devOtp ?? null);
      setStep("otp");
    } catch {
      setError("Can't reach the Bhookmark API — is the backend running on :4001?");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    setError(null);
    setLoading(true);
    try {
      const res = await verifyOtp(phone, otp);
      if (!res.ok) {
        setError(res.error ?? "That code didn't work.");
        return;
      }
      onSignedIn();
    } catch {
      setError("Can't reach the Bhookmark API — is the backend running on :4001?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-5 pt-16 pb-10 flex flex-col min-h-dvh">
      <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint mb-2">Bangalore</p>
      <h1 className="font-display font-extrabold text-3xl leading-tight mb-2 text-gradient">
        {step === "phone" ? "Sign in to Bhookmark" : "Enter the code"}
      </h1>
      <p className="text-muted text-sm mb-8 max-w-[32ch]">
        {step === "phone"
          ? "Phone number first — it's the fastest way in, and how a verified log gets tied to a real person."
          : `We sent a 6-digit code to ${phone}.`}
      </p>

      {step === "phone" ? (
        <>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            aria-label="Phone number"
            type="tel"
            autoComplete="tel"
            className="w-full bg-surface border border-line rounded-xl px-4 py-3.5 text-[15px] outline-none focus:border-accent transition-colors mb-4"
          />
          {error && <p className="text-bad text-sm mb-4">{error}</p>}
          <button
            onClick={handleRequestOtp}
            disabled={loading}
            className="w-full bg-accent text-accentInk font-semibold rounded-xl py-3.5 active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            {loading ? "Sending…" : "Send code"}
          </button>
        </>
      ) : (
        <>
          {devOtp && (
            <div className="bg-accentDim border border-accent/30 rounded-xl px-4 py-3 text-sm text-accent mb-4">
              DEV MODE — no SMS provider is wired up yet, so here's the code directly: <span className="font-mono font-semibold">{devOtp}</span>
            </div>
          )}
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            aria-label="6-digit verification code"
            autoComplete="one-time-code"
            className="w-full bg-surface border border-line rounded-xl px-4 py-3.5 text-[15px] tracking-[0.3em] text-center font-mono outline-none focus:border-accent transition-colors mb-4"
          />
          {error && <p className="text-bad text-sm mb-4">{error}</p>}
          <button
            onClick={handleVerify}
            disabled={loading || otp.length !== 6}
            className="w-full bg-accent text-accentInk font-semibold rounded-xl py-3.5 active:scale-[0.98] transition-transform disabled:opacity-60 mb-3"
          >
            {loading ? "Verifying…" : "Verify & continue"}
          </button>
          <button onClick={() => setStep("phone")} className="text-faint text-xs underline underline-offset-2 mx-auto">
            Use a different number
          </button>
        </>
      )}

      <div className="flex-1" />
      <p className="text-faint text-[11px] text-center">
        Your number is only ever used to verify a log — it's never shown publicly.
      </p>
    </div>
  );
}
