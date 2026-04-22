import Link from "next/link";
import type {
  PartnerProfileData,
  PartnerProfileSibling,
  PartnerProfileCampaignLink,
  PartnerProfileEvent,
  ContactEventDirection,
} from "@/lib/queries/partner-profile";
import { TierBadge } from "@/app/(authed)/tracker/TierBadge";

/**
 * Full partner profile view. Uses V4 vocabulary — `.section`,
 * `.m-section`, `.ms-card`, `.ms-kv`, `.tag-chip`, `.modal-grid` — so
 * the page shares visual identity with investor profiles and tracker
 * modals.
 *
 * Empty states follow the project voice: name the pipeline stage that
 * would fill the gap, never generic "No data" filler. Example: "No bio
 * on file yet — Forge Capital's nightly partner-enrichment step
 * (research/03-enrich-people.js) fills this."
 */
export function PartnerProfileView({
  partner,
}: {
  partner: PartnerProfileData;
}) {
  return (
    <div className="modal-grid" style={{ alignItems: "start" }}>
      <div>
        <PartnerHeadline partner={partner} />
        <FirmBlock firm={partner.firm} />
        <BioBlock partner={partner} />
        <FocusAreasBlock partner={partner} />
        <CampaignActivityBlock links={partner.campaign_links} />
        <RecentEventsBlock events={partner.recent_events} />
      </div>
      <SideRail partner={partner} />
    </div>
  );
}

function PartnerHeadline({ partner }: { partner: PartnerProfileData }) {
  return (
    <div className="m-section">
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <TierBadge tier={partner.email_tier} />
        {partner.is_primary_contact ? (
          <span className="tag-chip tag-approved">
            <span className="dot" />
            Primary contact
          </span>
        ) : null}
      </div>
      {partner.title ? (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-dim)",
          }}
        >
          {partner.title}
        </div>
      ) : null}
    </div>
  );
}

function FirmBlock({ firm }: { firm: PartnerProfileData["firm"] }) {
  if (!firm || firm.id == null) {
    return (
      <div className="m-section">
        <h3>Firm</h3>
        <p style={{ color: "var(--text-dim)" }}>
          Firm link missing — partner not wired to{" "}
          <code>investors_mirror</code>.
        </p>
      </div>
    );
  }
  return (
    <div className="m-section">
      <h3>Firm</h3>
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <Link
          href={`/investor/${firm.id}`}
          style={{
            fontWeight: 600,
            fontSize: 14,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          {firm.firm_name ?? "Unnamed firm"} ↗
        </Link>
        {firm.website ? (
          <a
            href={firm.website}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: "var(--accent)" }}
          >
            {firm.website.replace(/^https?:\/\//, "")} ↗
          </a>
        ) : null}
        {firm.hq_location ? (
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
            {firm.hq_location}
          </span>
        ) : null}
      </div>
      {firm.thesis_summary ? (
        <p>{firm.thesis_summary}</p>
      ) : (
        <p style={{ color: "var(--text-dim)" }}>
          No thesis on file for this firm yet — the nightly Forge Capital
          synthesiser writes it after enrichment.
        </p>
      )}
    </div>
  );
}

function BioBlock({ partner }: { partner: PartnerProfileData }) {
  if (!partner.bio && !partner.deep_bio) {
    return (
      <div className="m-section">
        <h3>Bio</h3>
        <p style={{ color: "var(--text-dim)" }}>
          No bio on file yet — Forge Capital&rsquo;s nightly
          partner-enrichment step (research/03-enrich-people.js) fills
          this.
        </p>
      </div>
    );
  }
  return (
    <div className="m-section">
      <h3>Bio</h3>
      {partner.bio ? <p>{partner.bio}</p> : null}
      {partner.deep_bio ? (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-dim)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            Deep bio
          </div>
          <p>{partner.deep_bio}</p>
        </div>
      ) : null}
    </div>
  );
}

function FocusAreasBlock({ partner }: { partner: PartnerProfileData }) {
  if (!partner.focus_areas) return null;
  return (
    <div className="m-section">
      <h3>Focus areas</h3>
      <p>{partner.focus_areas}</p>
    </div>
  );
}

function CampaignActivityBlock({
  links,
}: {
  links: PartnerProfileCampaignLink[];
}) {
  if (links.length === 0) {
    return (
      <div className="m-section">
        <h3>Campaign activity</h3>
        <p style={{ color: "var(--text-dim)" }}>
          This partner isn&rsquo;t on any of your campaigns yet —
          shortlisting from Find a Match will add a tracker row.
        </p>
      </div>
    );
  }
  return (
    <div className="m-section">
      <h3>Campaign activity · {links.length}</h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {links.map((l) => (
          <li
            key={l.campaign_partner_id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "10px 12px",
              background: "var(--surface-alt)",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
              }}
            >
              <Link
                href={`/tracker?c=${l.campaign_id}`}
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  color: "var(--accent)",
                  textDecoration: "none",
                }}
              >
                {l.campaign_name ?? "Unnamed campaign"} ↗
              </Link>
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                {l.days_since_last_contact === null
                  ? "No contact yet"
                  : l.days_since_last_contact === 0
                    ? "today"
                    : `${l.days_since_last_contact}d ago`}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
              {l.status_code ? (
                <>
                  <code>{l.status_code}</code>
                  {l.status_label ? ` ${l.status_label}` : ""}
                </>
              ) : (
                "No status set"
              )}
            </div>
            {l.approver_note ? (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-dim)",
                  marginTop: 6,
                  fontStyle: "italic",
                }}
              >
                &ldquo;{l.approver_note}&rdquo;
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function directionChip(direction: ContactEventDirection) {
  switch (direction) {
    case "inbound":
      return (
        <span className="tag-chip tag-approved" style={{ fontSize: 10 }}>
          <span className="dot" />
          Inbound
        </span>
      );
    case "outbound":
      return (
        <span className="tag-chip tag-status" style={{ fontSize: 10 }}>
          <span className="dot" />
          Outbound
        </span>
      );
    case "bounce":
      return (
        <span className="tag-chip tag-blocked" style={{ fontSize: 10 }}>
          <span className="dot" />
          Bounce
        </span>
      );
    case "auto_reply":
      return (
        <span className="tag-chip tag-warn" style={{ fontSize: 10 }}>
          <span className="dot" />
          Auto-reply
        </span>
      );
    case "manual":
      return (
        <span className="tag-chip tag-neutral" style={{ fontSize: 10 }}>
          Manual
        </span>
      );
    default:
      return (
        <span className="tag-chip tag-neutral" style={{ fontSize: 10 }}>
          —
        </span>
      );
  }
}

function formatEventTime(iso: string | null): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  const diffYear = Math.floor(diffDay / 365);
  return `${diffYear}y ago`;
}

function RecentEventsBlock({ events }: { events: PartnerProfileEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="m-section">
        <h3>Recent email events</h3>
        <p style={{ color: "var(--text-dim)" }}>
          No contact events recorded for this partner yet — events
          populate after the Gmail sync sees traffic.
        </p>
      </div>
    );
  }
  return (
    <div className="m-section">
      <h3>Recent email events · {events.length}</h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {events.map((e) => (
          <li
            key={e.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
              padding: "10px 0",
              borderBottom: "1px solid var(--border-soft)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 4,
                  flexWrap: "wrap",
                }}
              >
                {directionChip(e.direction)}
                {e.channel ? (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-faint)",
                    }}
                  >
                    {e.channel}
                  </span>
                ) : null}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text)",
                  lineHeight: 1.5,
                }}
              >
                {e.summary ?? (
                  <span style={{ color: "var(--text-faint)" }}>
                    No subject line recorded
                  </span>
                )}
              </div>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-faint)",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              {formatEventTime(e.event_at)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SideRail({ partner }: { partner: PartnerProfileData }) {
  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FactsCard partner={partner} />
      <ColleaguesCard siblings={partner.siblings} />
      <ProvenanceCard partner={partner} />
    </aside>
  );
}

function FactsCard({ partner }: { partner: PartnerProfileData }) {
  return (
    <div className="ms-card">
      <h4>Key facts</h4>
      <div className="ms-kv">
        <span className="k">Email tier</span>
        <span className="v">
          {partner.email_tier ?? (
            <span style={{ color: "var(--text-faint)" }}>—</span>
          )}
        </span>
      </div>
      <div className="ms-kv">
        <span className="k">Email</span>
        <span className="v" style={{ textAlign: "right" }}>
          {partner.email ? (
            <a
              href={`mailto:${partner.email}`}
              style={{ color: "var(--accent)" }}
            >
              {partner.email}
            </a>
          ) : (
            <span style={{ color: "var(--text-faint)" }}>No email on file</span>
          )}
        </span>
      </div>
      <div className="ms-kv">
        <span className="k">LinkedIn</span>
        <span className="v" style={{ textAlign: "right" }}>
          {partner.linkedin &&
          /^https?:\/\//i.test(partner.linkedin) ? (
            <a
              href={partner.linkedin}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)" }}
            >
              Profile ↗
            </a>
          ) : partner.linkedin ? (
            <span style={{ color: "var(--text-faint)" }}>
              {partner.linkedin}
            </span>
          ) : (
            <span style={{ color: "var(--text-faint)" }}>—</span>
          )}
        </span>
      </div>
      <div className="ms-kv">
        <span className="k">Twitter</span>
        <span className="v" style={{ textAlign: "right" }}>
          {partner.twitter &&
          /^https?:\/\//i.test(partner.twitter) ? (
            <a
              href={partner.twitter}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)" }}
            >
              Profile ↗
            </a>
          ) : partner.twitter ? (
            <span style={{ color: "var(--text-faint)" }}>
              {partner.twitter}
            </span>
          ) : (
            <span style={{ color: "var(--text-faint)" }}>—</span>
          )}
        </span>
      </div>
    </div>
  );
}

function ColleaguesCard({ siblings }: { siblings: PartnerProfileSibling[] }) {
  return (
    <div className="ms-card">
      <h4>
        Colleagues{siblings.length > 0 ? ` · ${siblings.length}` : ""}
      </h4>
      {siblings.length === 0 ? (
        <p
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
            margin: 0,
          }}
        >
          No other partners on file for this firm yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {siblings.map((s) => (
            <li
              key={s.id}
              style={{
                padding: "6px 0",
                borderBottom: "1px solid var(--border-soft)",
                fontSize: 12,
              }}
            >
              <Link
                href={`/partner/${s.id}`}
                style={{
                  color: "var(--accent)",
                  textDecoration: "none",
                  fontWeight: 500,
                }}
              >
                {s.name ?? "Unnamed partner"}
              </Link>
              {s.is_primary_contact ? (
                <span
                  className="tag-chip tag-approved"
                  style={{ marginLeft: 6, fontSize: 10 }}
                >
                  Primary
                </span>
              ) : null}
              {s.title ? (
                <div style={{ color: "var(--text-dim)", fontSize: 11 }}>
                  {s.title}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProvenanceCard({ partner }: { partner: PartnerProfileData }) {
  return (
    <div className="ms-card">
      <h4>Provenance</h4>
      <div className="ms-kv">
        <span className="k">Partner id</span>
        <span className="v">{partner.id}</span>
      </div>
      <div className="ms-kv">
        <span className="k">Last synced</span>
        <span className="v">
          {partner.last_synced_at ?? (
            <span style={{ color: "var(--text-faint)" }}>—</span>
          )}
        </span>
      </div>
      <p
        style={{
          fontSize: 11,
          color: "var(--text-faint)",
          marginTop: 8,
          lineHeight: 1.5,
        }}
      >
        Data mirrors the Forge Capital pipeline SQLite nightly — written
        by <code>research/03-enrich-people.js</code>. Edit at the source,
        not here.
      </p>
    </div>
  );
}
