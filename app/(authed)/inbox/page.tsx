import { getInboxReplies } from "@/lib/queries/inbox";
import { StatusBadge } from "../tracker/StatusBadge";

/**
 * Inbox / Replies — surfaces inbound contact events so Tristan doesn't
 * need to switch to Gmail to see who replied. Each row links to the
 * Gmail thread and the tracker row drawer for quick status updates.
 *
 * Data source: contact_events WHERE direction='inbound', newest first.
 * Empty until the Gmail sync daemon ingests reply events.
 */
export const dynamic = "force-dynamic";

function formatEventDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }) +
    " " +
    d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    })
  );
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const hours = Math.floor((now - then) / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export default async function InboxPage() {
  const replies = await getInboxReplies();

  return (
    <section id="inbox" className="section" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div>
          <div className="section-title">
            Inbox &mdash; replies from investors and partners
          </div>
          <div className="section-sub">
            Every inbound reply lands here. Click a row to open in Gmail
            or jump to the tracker to update status.
          </div>
        </div>
      </div>

      {replies.length === 0 ? (
        <InboxEmpty />
      ) : (
        <InboxTable replies={replies} />
      )}
    </section>
  );
}

function InboxTable({
  replies,
}: {
  replies: Awaited<ReturnType<typeof getInboxReplies>>;
}) {
  return (
    <div className="approval-col" style={{ overflow: "hidden" }}>
      <div className="sheet-head-strip">
        <div className="sh-left">
          <span className="sh-title">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}{" "}
            received
          </span>
          <span className="sh-meta">&middot; newest first</span>
        </div>
        <div className="sh-right">
          <span className="evidence-chip">
            <span className="dot" style={{ background: "var(--green)" }} />
            Live from contact events
          </span>
        </div>
      </div>

      <table className="sheet">
        <thead>
          <tr>
            <th style={{ width: "22%" }}>From</th>
            <th style={{ width: "14%" }}>Campaign</th>
            <th style={{ width: "10%" }}>Status</th>
            <th>Message</th>
            <th style={{ width: "10%" }}>When</th>
            <th style={{ width: "12%" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {replies.map((r) => (
            <tr key={r.id}>
              <td>
                <div className="firm-c">{r.firm_name ?? "—"}</div>
                <div className="contact-c">
                  {r.partner_name ?? "—"}
                  {r.partner_title ? ` · ${r.partner_title}` : ""}
                </div>
              </td>
              <td>
                <div className="contact-c">{r.campaign_name ?? "—"}</div>
              </td>
              <td>
                <StatusBadge
                  statusCode={r.status_code}
                  statusLabel={r.status_label}
                />
              </td>
              <td className="comment-af">
                {r.summary ? (
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 400,
                    }}
                    title={r.summary}
                  >
                    {r.summary}
                  </div>
                ) : (
                  <span
                    style={{
                      color: "var(--text-faint)",
                      fontStyle: "italic",
                    }}
                  >
                    (no preview)
                  </span>
                )}
              </td>
              <td
                style={{
                  fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
                title={formatEventDate(r.event_at)}
              >
                {formatRelative(r.event_at)}
              </td>
              <td
                style={{ display: "flex", gap: 6, alignItems: "center" }}
              >
                {r.gmail_thread_id ? (
                  <a
                    className="btn-gmail"
                    href={`https://mail.google.com/mail/u/0/#inbox/${r.gmail_thread_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in Gmail"
                  >
                    Gmail &#8599;
                  </a>
                ) : null}
                <a
                  className="btn-gmail"
                  href={`/tracker?expand=${r.campaign_partner_id}`}
                  title="Open in tracker"
                  style={{
                    background: "var(--surface)",
                    color: "var(--accent)",
                    border: "1px solid var(--border)",
                  }}
                >
                  Tracker →
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div
        style={{
          padding: "10px 16px",
          background: "var(--surface-alt)",
          borderTop: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
        }}
      >
        Showing {replies.length}{" "}
        {replies.length === 1 ? "reply" : "replies"} · sourced from
        Gmail sync
      </div>
    </div>
  );
}

function InboxEmpty() {
  return (
    <div className="approval-col" style={{ overflow: "hidden" }}>
      <div className="sheet-head-strip">
        <div className="sh-left">
          <span className="sh-title">0 replies</span>
          <span className="sh-meta">
            &middot; replies appear here once the Gmail sync daemon
            ingests them
          </span>
        </div>
      </div>
      <div
        style={{
          padding: "32px 24px",
          textAlign: "center",
          fontSize: 13,
          color: "var(--text-dim)",
          lineHeight: 1.55,
        }}
      >
        No replies yet. When investors reply to your outreach, their
        messages appear here automatically via Gmail sync.
      </div>
      <div
        style={{
          padding: "10px 16px",
          background: "var(--surface-alt)",
          borderTop: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--accent)",
          fontWeight: 600,
          textAlign: "right",
        }}
      >
        &larr; Gmail is authoritative. We read; we never send from this
        view.
      </div>
    </div>
  );
}
