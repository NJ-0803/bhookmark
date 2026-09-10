import { useEffect, useRef, useState } from "react";
import { requestOtp, signInWithGoogle, verifyOtp } from "../api";

// Minimal shape of the bit of Google Identity Services this actually
// calls — loaded globally via the <script> tag in index.html. No SDK
// package needed for just "render a button, get a credential back."
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: { client_id: string; callback: (resp: { credential: string }) => void }): void;
          renderButton(el: HTMLElement, options: Record<string, unknown>): void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("+91");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPhoneFallback, setShowPhoneFallback] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  // Real, free identity provider (F01 in the 2026-09-08 implementation
  // brief) — there's no SMS vendor configured, so this is the login path
  // that actually works today, not a placeholder next to a dead-end one.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    async function handleCredential(resp: { credential: string }) {
      setError(null);
      setGoogleError(null);
      setLoading(true);
      try {
        const res = await signInWithGoogle(resp.credential);
        if (res.ok) onSignedIn();
        else setGoogleError(res.error ?? "That Google sign-in didn't work.");
      } catch {
        setGoogleError("Can't reach the Bhookmark API — is the backend running?");
      } finally {
        setLoading(false);
      }
    }

    function renderButton() {
      if (!googleButtonRef.current || !window.google) return;
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID!, callback: handleCredential });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "filled_black",
        size: "large",
        shape: "pill",
        width: 320,
        text: "continue_with",
      });
    }

    if (window.google?.accounts?.id) {
      renderButton();
    } else {
      // The gsi/client script loads async — it may not be ready yet on a
      // fast render. Poll briefly instead of assuming a fixed load order.
      const interval = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(interval);
          renderButton();
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [onSignedIn]);

  async function handleRequestOtp() {
    setError(null);
    setLoading(true);
    try {
      const res = await requestOtp(phone);
      if (!res.ok) {
        setError(res.smsUnavailable ? "SMS isn't set up yet — use Google Sign-In above instead." : res.error ?? "Couldn't send a code. Try again.");
        return;
      }
      setDevOtp(res.devOtp ?? null);
      setStep("otp");
    } catch {
      setError("Can't reach the Bhookmark API — is the backend running?");
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
      setError("Can't reach the Bhookmark API — is the backend running?");
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
        {step === "phone" ? "One tap with Google, or use a phone number below." : `We sent a 6-digit code to ${phone}.`}
      </p>

      {step === "phone" && (
        <>
          {GOOGLE_CLIENT_ID ? (
            <div className="mb-3 flex justify-center">
              <div ref={googleButtonRef} />
            </div>
          ) : (
            <div className="bg-surface2 border border-line rounded-xl px-4 py-3 text-xs text-faint mb-3">
              Google Sign-In isn't configured on this deployment yet (missing VITE_GOOGLE_CLIENT_ID) — use a phone number below.
            </div>
          )}
          {googleError && <p className="text-bad text-sm mb-3">{googleError}</p>}

          {GOOGLE_CLIENT_ID && !showPhoneFallback ? (
            <button onClick={() => setShowPhoneFallback(true)} className="text-faint text-xs underline underline-offset-2 mx-auto mt-1">
              Use a phone number instead
            </button>
          ) : (
            <>
              <div className="h-px bg-line my-5" />
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
                className="w-full bg-surface border border-line text-ink font-semibold rounded-xl py-3.5 active:scale-[0.98] transition-transform disabled:opacity-60"
              >
                {loading ? "Sending…" : "Send code"}
              </button>
            </>
          )}
        </>
      )}

      {step === "otp" && (
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
        Your phone number or Google account is only ever used to verify a log — it's never shown publicly.
      </p>
    </div>
  );
}
