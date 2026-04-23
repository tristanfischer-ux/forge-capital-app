"use client";

import { useEffect, useState } from "react";

interface ServiceStatus {
  status:
    | "connected"
    | "scope_missing"
    | "expired"
    | "error"
    | "not_connected";
  scopeOk: boolean;
  sampleCount: number | null;
  lastSyncAt: string | null;
  latencyMs: number | null;
  detail: string | null;
}

interface HealthResponse {
  gmail: ServiceStatus;
  calendar: ServiceStatus;
  scope: string | null;
  checkedAt: string;
}

/**
 * Live Gmail + Calendar status pill in the top bar. Polls
 * /api/gmail-health every 30s. Concrete visual state:
 *
 *   ✓ Gmail + Calendar live     (both connected)
 *   ⚠ Calendar scope missing    (gmail works, calendar needs reconnect)
 *   ⚠ Gmail unreachable         (either service errored)
 *   ✗ Not connected             (no gmail_tokens row)
 *
 * Tristan 2026-04-23: *"I want to have some kind of signal showing
 * that it is working … There has to be some kind of button showing
 * that something's happening."* Clickable → opens a small detail
 * popover with per-service status, last-sync timestamps, and a
 * "Reconnect Google" link when scope is missing.
 */

export function GoogleConnectionStatus() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gmail-health", { cache: "no-store" });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as HealthResponse;
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

  const bothOk =
    data?.gmail.status === "connected" && data?.calendar.status === "connected";
  const anyScopeMissing =
    data?.gmail.status === "scope_missing" ||
    data?.calendar.status === "scope_missing";
  const notConnected =
    data?.gmail.status === "not_connected" &&
    data?.calendar.status === "not_connected";
  const expired =
    data?.gmail.status === "expired" || data?.calendar.status === "expired";

  const { label, colour, background, border } = (() => {
    if (error) {
      return {
        label: "probe error",
        colour: "var(--red)",
        background: "var(--red-light)",
        border: "var(--red)",
      };
    }
    if (loading && !data) {
      return {
        label: "checking…",
        colour: "var(--text-dim)",
        background: "var(--surface-alt)",
        border: "var(--border)",
      };
    }
    if (notConnected) {
      return {
        label: "Google not connected",
        colour: "var(--red)",
        background: "var(--red-light)",
        border: "var(--red)",
      };
    }
    if (expired) {
      return {
        label: "Google expired — reconnect",
        colour: "var(--red)",
        background: "var(--red-light)",
        border: "var(--red)",
      };
    }
    if (anyScopeMissing) {
      return {
        label:
          data?.calendar.status === "scope_missing"
            ? "Calendar scope missing"
            : "Gmail scope missing",
        colour: "var(--amber)",
        background: "var(--amber-light)",
        border: "var(--amber)",
      };
    }
    if (bothOk) {
      return {
        label: "Gmail + Calendar live",
        colour: "var(--green)",
        background: "var(--green-light)",
        border: "var(--green)",
      };
    }
    return {
      label: "Google degraded",
      colour: "var(--amber)",
      background: "var(--amber-light)",
      border: "var(--amber)",
    };
  })();

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Click for detail — polls /api/gmail-health every 30s."
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 600,
          color: colour,
          background,
          border: `1px solid ${border}`,
          borderRadius: 999,
          cursor: "pointer",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: colour,
            animation: bothOk ? "fcPulse 2.4s ease-in-out infinite" : "none",
          }}
        />
        {label}
      </button>

      {open && data ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 280,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
            padding: 12,
            zIndex: 200,
            fontSize: 12,
          }}
        >
          <ServiceRow label="Gmail" s={data.gmail} />
          <div style={{ height: 8 }} />
          <ServiceRow label="Calendar" s={data.calendar} />
          {(anyScopeMissing || expired || notConnected) ? (
            <a
              href="/api/auth/gmail"
              style={{
                display: "inline-block",
                marginTop: 10,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 600,
                color: "#fff",
                background: "var(--accent)",
                borderRadius: 4,
                textDecoration: "none",
              }}
            >
              Reconnect Google →
            </a>
          ) : null}
          <div
            style={{
              marginTop: 10,
              paddingTop: 8,
              borderTop: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              fontSize: 10,
              color: "var(--text-faint)",
            }}
          >
            <span>
              Probe {new Date(data.checkedAt).toLocaleTimeString("en-GB")}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                refresh();
              }}
              disabled={loading}
              style={{
                fontSize: 10,
                padding: "1px 6px",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                borderRadius: 3,
                cursor: "pointer",
                color: "var(--text-dim)",
              }}
            >
              {loading ? "…" : "Refresh"}
            </button>
          </div>
        </div>
      ) : null}
      <style jsx>{`
        @keyframes fcPulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.35;
          }
        }
      `}</style>
    </div>
  );
}

function ServiceRow({ label, s }: { label: string; s: ServiceStatus }) {
  const badge =
    s.status === "connected"
      ? "✓"
      : s.status === "scope_missing" || s.status === "expired"
        ? "⚠"
        : "✗";
  const colour =
    s.status === "connected"
      ? "var(--green)"
      : s.status === "scope_missing"
        ? "var(--amber)"
        : "var(--red)";
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ color: colour, fontWeight: 700 }}>{badge}</span>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
          · {s.status.replace(/_/g, " ")}
        </span>
      </div>
      {s.latencyMs !== null ? (
        <div style={{ fontSize: 10, color: "var(--text-faint)", marginLeft: 18 }}>
          API round-trip {s.latencyMs}ms
          {s.sampleCount !== null
            ? ` · ${s.sampleCount} item${s.sampleCount === 1 ? "" : "s"} sample`
            : ""}
        </div>
      ) : null}
      {s.lastSyncAt ? (
        <div style={{ fontSize: 10, color: "var(--text-faint)", marginLeft: 18 }}>
          Last cron run: {new Date(s.lastSyncAt).toLocaleString("en-GB")}
        </div>
      ) : null}
      {s.detail ? (
        <div
          style={{
            fontSize: 10,
            color: "var(--text-dim)",
            marginLeft: 18,
            marginTop: 2,
            lineHeight: 1.4,
          }}
        >
          {s.detail}
        </div>
      ) : null}
    </div>
  );
}
