"use client";

import Link from "next/link";
import type { CustomerCampaignPartnerCard } from "@/lib/queries/customer-partners";

/**
 * Customer-side result rendering on Find-a-Match.
 *
 * Customer outreach isn't semantic-pool-ranked — the list is a
 * curated set (the 93 Fischer Farms prospects from the V4 briefing,
 * or whatever the founder has shortlisted). But Tristan 2026-04-24:
 * "I would expect to see all the match customers in that box."
 *
 * So instead of the pool-empty placeholder, we render the campaign's
 * existing customer_partners as cards. Each card surfaces:
 *  - Firm name + country flag + type (grower / DIY / DTC / …)
 *  - Wave (1 / 2 / 3 / Niche) as a coloured pill so Wave-1 leads
 *    stand out
 *  - Pitch hook (the one-line "why them" angle from the briefing)
 *  - Expected £ EBITDA per container
 *  - Current contact name + title + contact-count badge (so firms
 *    that still need email-hunt enrichment are visible at a glance)
 *  - Status badge (+0 Pending approval, +1 Approved, +3 Email sent)
 *  - "Open in approval →" link to /approval?c=<id>#<row>
 */

export interface CustomerPartnerCardsProps {
  cards: CustomerCampaignPartnerCard[];
  campaignId: string;
}

const FLAG_BY_COUNTRY: Record<string, string> = {
  SE: "🇸🇪",
  NO: "🇳🇴",
  DK: "🇩🇰",
  FI: "🇫🇮",
  IS: "🇮🇸",
  CA: "🇨🇦",
  US: "🇺🇸",
  DE: "🇩🇪",
  NL: "🇳🇱",
  FR: "🇫🇷",
  BE: "🇧🇪",
  PL: "🇵🇱",
  GB: "🇬🇧",
};

export function CustomerPartnerCards({
  cards,
  campaignId,
}: CustomerPartnerCardsProps) {
  if (cards.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {cards.map((card) => (
        <CustomerCard key={card.campaign_partner_id} card={card} campaignId={campaignId} />
      ))}
    </div>
  );
}

function CustomerCard({
  card,
  campaignId,
}: {
  card: CustomerCampaignPartnerCard;
  campaignId: string;
}) {
  const flag = card.country_iso ? FLAG_BY_COUNTRY[card.country_iso] ?? "" : "";
  const ebitda =
    card.expected_ebitda_gbp && card.expected_ebitda_gbp > 0
      ? `£${Math.round(card.expected_ebitda_gbp / 1000).toLocaleString("en-GB")}K EBITDA`
      : null;
  const contactLine = [card.partner_name, card.partner_title]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .join(" · ");

  return (
    <div
      className="result-card"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 16px",
        background: "var(--surface)",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 10,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {flag ? <span style={{ fontSize: 14 }}>{flag}</span> : null}
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text)",
            }}
          >
            {card.firm_name ?? "— unnamed customer —"}
          </span>
          {card.website ? (
            <a
              href={`https://${card.website.replace(/^https?:\/\//, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 11,
                color: "var(--text-faint)",
                textDecoration: "none",
              }}
            >
              {card.website} ↗
            </a>
          ) : null}
          <WaveChip wave={card.wave} />
          <StatusChip code={card.status_code} label={card.status_label} />
        </div>

        {card.pitch_hook ? (
          <p
            style={{
              margin: "6px 0 0 0",
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--text-dim)",
            }}
          >
            {card.pitch_hook}
          </p>
        ) : null}

        <div
          style={{
            marginTop: 6,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            fontSize: 11,
            color: "var(--text-faint)",
          }}
        >
          {card.type ? <span>{card.type}</span> : null}
          {card.hq_location ? <span>· {card.hq_location}</span> : null}
          {ebitda ? <span>· {ebitda}</span> : null}
          {contactLine ? <span>· {contactLine}</span> : null}
          <span
            style={{
              color:
                card.contact_count > 1
                  ? "var(--accent)"
                  : "var(--text-faint)",
            }}
          >
            · {card.contact_count}{" "}
            {card.contact_count === 1 ? "contact" : "contacts"}
          </span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <Link
          href={`/approval?c=${campaignId}#${card.campaign_partner_id}`}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--accent)",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Open in approval →
        </Link>
      </div>
    </div>
  );
}

function WaveChip({ wave }: { wave: "1" | "2" | "3" | "niche" | null }) {
  if (!wave) return null;
  const label = wave === "niche" ? "Niche" : `Wave ${wave}`;
  const colour =
    wave === "1"
      ? { bg: "#dcfce7", fg: "#166534" }
      : wave === "2"
        ? { bg: "#e0e7ff", fg: "#3730a3" }
        : wave === "3"
          ? { bg: "#fef3c7", fg: "#92400e" }
          : { bg: "#f1f5f9", fg: "#475569" };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        padding: "2px 6px",
        borderRadius: 999,
        background: colour.bg,
        color: colour.fg,
      }}
    >
      {label}
    </span>
  );
}

function StatusChip({
  code,
  label,
}: {
  code: string | null;
  label: string | null;
}) {
  if (!code) return null;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 6px",
        borderRadius: 4,
        background: "var(--surface-alt)",
        color: "var(--text-dim)",
      }}
      title={label ?? ""}
    >
      {code}
      {label ? ` · ${label}` : ""}
    </span>
  );
}
