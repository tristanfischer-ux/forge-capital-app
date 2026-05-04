"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

/**
 * Landing page. Magic-link login.
 *
 * Surfaces auth errors from three channels: user-initiated send failures
 * (caught inline), query param `?auth_error=` forwarded from our callback
 * route handler, and URL-fragment errors from Supabase when the magic link
 * expired or was tampered with (fragments aren't server-visible, so we
 * read them client-side on mount).
 */

function readFragmentError(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const desc = params.get("error_description");
  const code = params.get("error_code");
  if (desc) return desc.replace(/\+/g, " ");
  if (code) return code;
  return null;
}

function readQueryError(): string | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  return q.get("auth_error");
}

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [priorError, setPriorError] = useState<string | null>(null);

  // On mount: (1) if the URL fragment carries #access_token= (Supabase
  // implicit flow — admin-generated links during testing, or projects
  // with legacy config), convert it to a session cookie via setSession()
  // then redirect. (2) Otherwise surface any prior auth error.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const hash = window.location.hash.replace(/^#/, "");
    if (hash) {
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken && refreshToken) {
        (async () => {
          const supabase = createBrowserClient();
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            setPriorError(error.message);
            window.history.replaceState({}, "", "/");
            return;
          }
          const next =
            new URLSearchParams(window.location.search).get("next") ?? "/discover";
          window.location.replace(next);
        })();
        return;
      }
    }

    const q = readQueryError();
    const frag = readFragmentError();
    const msg = q ?? frag;
    if (msg) {
      setPriorError(msg);
      const cleanUrl =
        window.location.pathname + (window.location.search ? `` : ``);
      window.history.replaceState({}, "", cleanUrl || "/");
    }
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;
    setStatus({ kind: "sending" });
    try {
      const supabase = createBrowserClient();
      const next =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("next") ?? "/discover"
          : "/discover";

      if (usePassword) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          setStatus({ kind: "error", message: error.message || "Invalid email or password." });
          return;
        }
        window.location.replace(next);
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo:
              typeof window !== "undefined"
                ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
                : undefined,
          },
        });
        if (error) {
          setStatus({ kind: "error", message: error.message || "Could not send magic link. Please try again." });
          return;
        }
        setStatus({ kind: "sent" });
      }
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : typeof err === "string"
            ? err
            : JSON.stringify(err) || "Unknown error";
      setStatus({ kind: "error", message });
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="bg-surface border border-border rounded shadow-md p-8">
          <div className="mb-6">
            <div className="text-xs uppercase tracking-widest text-accent font-semibold mb-2">
              Fractional Forge
            </div>
            <h1 className="text-2xl font-semibold text-text mb-1">
              Forge Capital
            </h1>
            <p className="text-sm text-text-dim">
              Signing you in — enter your email and we&rsquo;ll send a magic
              link.
            </p>
          </div>

          {priorError ? (
            <div className="mb-4 rounded-sm border border-[#fecaca] bg-red-light px-3 py-2.5 text-[11px] leading-relaxed text-red">
              <div className="mb-0.5 font-semibold">Previous sign-in didn&rsquo;t complete</div>
              <div className="text-[11px] normal-case text-red/90">
                {humaniseError(priorError)}
              </div>
              <div className="mt-1 text-[10px] text-red/70">
                Request a fresh magic link below — old links expire quickly.
              </div>
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="block text-xs font-medium text-text-dim mb-1.5">
                Email address
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tristan.fischer@gmail.com"
                className="w-full px-3 py-2 bg-surface-alt border border-border rounded-sm text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                disabled={status.kind === "sending" || status.kind === "sent"}
              />
            </label>
            {usePassword ? (
              <label className="block">
                <span className="block text-xs font-medium text-text-dim mb-1.5">
                  Password
                </span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-3 py-2 bg-surface-alt border border-border rounded-sm text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  disabled={status.kind === "sending"}
                />
              </label>
            ) : null}
            <button
              type="submit"
              disabled={status.kind === "sending" || status.kind === "sent"}
              className="w-full px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-sm text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status.kind === "sending"
                ? usePassword ? "Signing in…" : "Sending link…"
                : status.kind === "sent"
                  ? "Link sent — check your inbox"
                  : usePassword ? "Sign in" : "Send magic link"}
            </button>
            {!usePassword ? (
              <button
                type="button"
                onClick={() => setUsePassword(true)}
                className="w-full text-xs text-text-dim hover:text-accent transition-colors"
              >
                Use password instead
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setUsePassword(false)}
                className="w-full text-xs text-text-dim hover:text-accent transition-colors"
              >
                Use magic link instead
              </button>
            )}
          </form>

          {status.kind === "error" ? (
            <p className="mt-4 text-xs text-red">
              {status.message || "Sign-in failed. Please try again."}
            </p>
          ) : null}
          {status.kind === "sent" ? (
            <p className="mt-4 text-xs text-text-dim">
              Open the email on this device. The link will bring you back here
              signed in.
            </p>
          ) : null}
        </div>
        <p className="mt-4 text-center text-xs text-text-faint">
          Magic links expire after ~60 minutes &middot; or use your password
        </p>
      </div>
    </main>
  );
}

function humaniseError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("otp_expired") || lower.includes("expired")) {
    return "Your magic link expired. Request a fresh one.";
  }
  if (lower.includes("link_missing_code")) {
    return "The sign-in link wasn't complete — it may have already been used, or expired. Request a fresh one.";
  }
  if (lower.includes("access_denied")) {
    return "Sign-in was denied — the link was invalid, expired, or already used.";
  }
  return raw;
}
