"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

/**
 * Phase 0 placeholder landing. Magic-link login scaffold only.
 * Real auth allowlisting, redirect handling, and session-aware tracker grid
 * arrive in Phase 1+.
 */
export default function HomePage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;
    setStatus({ kind: "sending" });
    try {
      const supabase = createBrowserClient();
      const next =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("next") ?? "/tracker"
          : "/tracker";
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
        setStatus({ kind: "error", message: error.message });
        return;
      }
      setStatus({ kind: "sent" });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
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
            <button
              type="submit"
              disabled={status.kind === "sending" || status.kind === "sent"}
              className="w-full px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-sm text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status.kind === "sending"
                ? "Sending link…"
                : status.kind === "sent"
                  ? "Link sent — check your inbox"
                  : "Send magic link"}
            </button>
          </form>

          {status.kind === "error" ? (
            <p className="mt-4 text-xs text-red">{status.message}</p>
          ) : null}
          {status.kind === "sent" ? (
            <p className="mt-4 text-xs text-text-dim">
              Open the email on this device. The link will bring you back here
              signed in.
            </p>
          ) : null}
        </div>
        <p className="mt-4 text-center text-xs text-text-faint">
          Phase 0 scaffold &middot; tracker grid arrives in Phase 2
        </p>
      </div>
    </main>
  );
}
