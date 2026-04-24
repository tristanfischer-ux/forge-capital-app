"use client";

import { useEffect, useState, useTransition } from "react";
import { STATUS_CODES } from "@/lib/status-codes";
import { statusCodesVisibleFor } from "@/lib/queries/self-managed";
import { fetchContactEvents, updateCampaignPartnerStatus } from "./actions";
import type { ContactEventRow } from "@/lib/queries/campaignPartner";
import { ContactPicker } from "../ContactPicker";

/**
 * Expanded-row drawer on the tracker grid. Two jobs:
 *
 *   1. Show the full contact-event history for this (campaign, partner)
 *      — newest first, newest on top. Same `[YYYY-MM-DD] body` shape as
 *      the xlsx commentary convention Tristan has been using, so the
 *      migrated xlsx rows and the new ones look uniform.
 *
 *   2. Let Tristan update status_code + append a commentary line in
 *      one transaction. The server action derives status_label from the
 *      legend and logs a contact_events row for the change, so the
 *      history in (1) grows by one every time he saves.
 *
 * The draft-preview link is kept in the drawer too — clicking it opens
 * the /tracker/<id>/draft route that Phase 3 shipped.
 */

export interface TrackerRowDrawerProps {
  campaignPartnerId: string;
  currentStatusCode: string | null;
  firmName: string | null;
  /**
   * Campaign counterpart email — drives the self-managed check that
   * hides +6.5 from the status dropdown. Multi-party campaigns
   * (FishFrom) keep +6.5 visible; self-managed campaigns (SkySails,
   * Panatere, ForgeOS, Fischer Farms Customer) drop it since there's
   * no external company side to hand over to.
   *
   * Plumbed from TrackerTable to avoid a second DB round-trip on
   * drawer-open. Pass null when no counterpart is configured.
   */
  campaignCounterpartEmail: string | null;
}

function formatEventDate(iso: string): string {
  const d = new Date(iso);
  // DD Mmm YYYY HH:mm — British style, matches the xlsx sheet convention.
  return d.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  }) + " " + d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit",
  });
}

export function TrackerRowDrawer({
  campaignPartnerId,
  currentStatusCode,
  firmName,
  campaignCounterpartEmail,
}: TrackerRowDrawerProps) {
  const [statusCode, setStatusCode] = useState<string>(currentStatusCode ?? "");
  const isCodeVisible = statusCodesVisibleFor({
    counterpart_email: campaignCounterpartEmail,
  });
  const [commentary, setCommentary] = useState<string>("");
  const [events, setEvents] = useState<ContactEventRow[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { kind: "idle" } | { kind: "ok" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  // Fetch commentary log on mount. Cheap — one query, ≤50 rows.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchContactEvents(campaignPartnerId);
      if (!cancelled) {
        setEvents(rows);
        setEventsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignPartnerId]);

  const hasChange =
    (statusCode || "") !== (currentStatusCode ?? "") || commentary.trim().length > 0;

  function onSave() {
    if (!hasChange || isPending) return;
    setResult({ kind: "idle" });
    startTransition(async () => {
      const out = await updateCampaignPartnerStatus({
        campaignPartnerId,
        statusCode: statusCode || null,
        commentary: commentary || null,
      });
      if (out.ok) {
        setResult({ kind: "ok" });
        setCommentary("");
        // Refresh the log with the new event we just wrote.
        const rows = await fetchContactEvents(campaignPartnerId);
        setEvents(rows);
      } else {
        setResult({ kind: "error", message: out.error });
      }
    });
  }

  return (
    <div className="border-t border-border-soft bg-surface-alt px-6 py-4">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Left: edit form */}
        <div>
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-accent">
            Update status{firmName ? ` · ${firmName}` : ""}
          </div>

          {/* Contact picker — swap which person at the firm this row is
              addressed to. Swap clears the cached draft + cancels any
              pending scheduled_sends so the composer regenerates for
              the new person (Tristan 2026-04-24 direction). */}
          <div className="mb-3">
            <span className="mb-1 block text-[11px] font-medium text-text-dim">
              Reaching out to
            </span>
            <ContactPicker
              campaignPartnerId={campaignPartnerId}
              currentLabel="View / switch contact"
            />
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="block text-[11px] font-medium text-text-dim mb-1">
                Status code
              </span>
              <select
                value={statusCode}
                onChange={(e) => setStatusCode(e.target.value)}
                className="w-full rounded-sm border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                disabled={isPending}
              >
                <option value="">— not set —</option>
                {STATUS_CODES.filter((s) => isCodeVisible(s.code)).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} · {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-[11px] font-medium text-text-dim mb-1">
                Commentary (append to log)
              </span>
              <textarea
                value={commentary}
                onChange={(e) => setCommentary(e.target.value)}
                rows={3}
                placeholder="e.g. Called Andrew; he'll circle back after Thursday."
                className="w-full rounded-sm border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                disabled={isPending}
              />
              <span className="mt-1 block text-[10px] text-text-faint">
                Saving also records a contact event and (if commentary non-empty) bumps the last-contact timestamp.
              </span>
            </label>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onSave}
                disabled={!hasChange || isPending}
                className="rounded-sm bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? "Saving…" : "Save"}
              </button>
              {result.kind === "ok" ? (
                <span className="text-[11px] text-green">Saved.</span>
              ) : null}
              {result.kind === "error" ? (
                <span className="text-[11px] text-red">{result.message}</span>
              ) : null}

              <a
                href={`/tracker/${campaignPartnerId}/draft`}
                className="ml-auto rounded-sm border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-accent hover:border-accent hover:bg-accent-softer"
              >
                Draft email preview →
              </a>
            </div>
          </div>
        </div>

        {/* Right: commentary log */}
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-accent">
              Commentary log
            </div>
            <span className="text-[10px] text-text-faint">
              {events.length} {events.length === 1 ? "entry" : "entries"} · newest first
            </span>
          </div>

          {!eventsLoaded ? (
            <div className="rounded-sm border border-border-soft bg-surface px-3 py-4 text-[11px] italic text-text-faint">
              Loading log…
            </div>
          ) : events.length === 0 ? (
            <div className="rounded-sm border border-border-soft bg-surface px-3 py-4 text-[11px] italic text-text-faint">
              No entries yet. Save a commentary line above to start the log.
            </div>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {events.map((ev) => {
                const isTest = ev.event_type === "test_send";
                const isReply = ev.event_type?.startsWith("inbound_reply_");
                return (
                  <li
                    key={ev.id}
                    className={`rounded-sm border px-3 py-2 text-[11px] leading-relaxed text-text ${
                      isTest
                        ? "border-amber bg-amber-light"
                        : isReply
                          ? "border-[#c7d2fe] bg-accent-softer"
                          : "border-border-soft bg-surface"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-text-dim">
                      <span className="font-semibold">
                        {formatEventDate(ev.event_at)}
                      </span>
                      {isTest ? (
                        <span
                          className="rounded-full bg-amber px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
                          title="Dry-run dispatch to a review inbox — tracker status was NOT advanced."
                        >
                          TEST
                        </span>
                      ) : null}
                      {ev.direction ? (
                        <span className="rounded-full bg-surface-alt px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-faint">
                          {ev.direction}
                        </span>
                      ) : null}
                      {ev.channel ? (
                        <span className="rounded-full bg-surface-alt px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-faint">
                          {ev.channel}
                        </span>
                      ) : null}
                      {ev.event_type ? (
                        <span className="text-text-faint">
                          · {ev.event_type.replace(/_/g, " ")}
                        </span>
                      ) : null}
                      {ev.gmail_thread_id ? (
                        <a
                          href={`https://mail.google.com/mail/u/0/#${
                            ev.direction === "inbound" ? "inbox" : "sent"
                          }/${ev.gmail_thread_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-accent hover:text-accent-dark"
                        >
                          open in Gmail ↗
                        </a>
                      ) : null}
                    </div>
                    {ev.summary ? (
                      <div className="mt-1 whitespace-pre-wrap">{ev.summary}</div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
