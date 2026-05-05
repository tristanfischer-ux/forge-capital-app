"use client";

import { useEffect, useState } from "react";
import type { CrossCampaignInvestor, CampaignEntry } from "@/lib/queries/cross-campaign-investors";

/**
 * Cross-campaign Master Investor Tracker — simplified.
 * Columns: Investor | Contact | Campaigns | Status | Expand for detail
 */
export default function InvestorsPageClient({
  investors,
  campaignNames,
}: {
  investors: CrossCampaignInvestor[];
  campaignNames: string[];
}) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const filtered = investors.filter((inv) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      inv.firm_name.toLowerCase().includes(q) ||
      (inv.contact_name ?? "").toLowerCase().includes(q)
    );
  });

  const overlapCount = investors.filter((i) => i.overlap_count > 1).length;

  return (
    <div style={{ padding: "24px 32px" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          Master Investor Tracker
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}>
          Every investor you have ever reached out to, across all campaigns. Click a row for campaign details.
        </p>
      </div>

      {/* Summary tiles */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <Tile label="Total Investors" value={investors.length} />
        <Tile label="Campaigns" value={campaignNames.length} />
        <Tile label="Overlapping" value={overlapCount} highlight />
        <Tile
          label="Currently Active"
          value={investors.filter((i) => {
            const code = parseInt(i.best_status?.replace(/[^0-9-]/g, "") ?? "0", 10);
            return code > 0;
          }).length}
        />
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search by firm name or contact..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 12px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 14,
            background: "var(--surface)",
          }}
        />
      </div>

      {/* Clean table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Investor</th>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Contact</th>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Campaigns</th>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Best Status</th>
              <th style={{ padding: "8px 12px", fontWeight: 600, width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inv) => (
              <InvestorRow
                key={inv.investor_id}
                investor={inv}
                expanded={expandedId === inv.investor_id}
                onToggle={() => setExpandedId(expandedId === inv.investor_id ? null : inv.investor_id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-dim)" }}>
          No investors match your search.
        </div>
      )}
    </div>
  );
}

function InvestorRow({
  investor,
  expanded,
  onToggle,
}: {
  investor: CrossCampaignInvestor;
  expanded: boolean;
  onToggle: () => void;
}) {
  const campaignNames = investor.campaigns.map((c) => c.campaign_name).join(", ");
  const hasOverlap = investor.overlap_count > 1;

  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          borderBottom: "1px solid var(--border)",
          cursor: "pointer",
          background: hasOverlap ? "rgba(255, 69, 0, 0.03)" : undefined,
        }}
      >
        <td style={{ padding: "8px 12px", fontWeight: 600 }}>
          {investor.firm_name}
          {investor.entity_type && (
            <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 6 }}>
              {investor.entity_type}
            </span>
          )}
        </td>
        <td style={{ padding: "8px 12px" }}>
          {investor.contact_name ?? "—"}
          {investor.contact_title && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}> · {investor.contact_title}</span>
          )}
        </td>
        <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-dim)" }}>
          {campaignNames}
          {hasOverlap && (
            <span style={{ marginLeft: 6, color: "var(--orange)", fontWeight: 700, fontSize: 11 }}>
              ({investor.overlap_count} campaigns)
            </span>
          )}
        </td>
        <td style={{ padding: "8px 12px" }}>
          <StatusBadge code={investor.best_status} label={investor.best_status_label} />
        </td>
        <td style={{ padding: "8px 12px", textAlign: "center", color: "var(--text-dim)" }}>
          {expanded ? "▲" : "▼"}
        </td>
      </tr>

      {/* Expanded detail — per-campaign breakdown */}
      {expanded && (
        <tr>
          <td colSpan={5} style={{ padding: "12px 16px", background: "var(--surface-alt, #f8f9fa)", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              {investor.campaigns.map((cs) => (
                <div key={cs.campaign_id} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "4px 0",
                  borderBottom: "1px solid var(--border)",
                }}>
                  <span style={{ fontWeight: 600 }}>{cs.campaign_name}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <StatusBadge code={cs.status_code} label={cs.status_label} />
                    {cs.days_since !== null && (
                      <span style={{ color: "var(--text-dim)" }}>{cs.days_since}d ago</span>
                    )}
                    {cs.permission_status !== "not_required" && (
                      <span style={{
                        fontSize: 10,
                        padding: "2px 6px",
                        borderRadius: 3,
                        background: cs.permission_status === "approved" ? "rgba(34,197,94,0.1)" : cs.permission_status === "denied" ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)",
                        color: cs.permission_status === "approved" ? "#16a34a" : cs.permission_status === "denied" ? "#dc2626" : "#d97706",
                      }}>
                        {cs.permission_status}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Tile({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={{
      padding: "12px 20px",
      background: "var(--surface)",
      borderRadius: 8,
      border: "1px solid var(--border)",
      minWidth: 120,
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: highlight ? "var(--orange)" : undefined }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
    </div>
  );
}

function StatusBadge({ code, label }: { code: string | null; label: string | null }) {
  if (!code) return <span style={{ color: "var(--text-faint)" }}>—</span>;

  const num = parseInt(code.replace(/[^0-9-]/g, ""), 10);
  let color = "var(--text-dim)";
  if (num > 5) color = "var(--success)";
  else if (num > 0) color = "var(--accent)";
  else if (num < 0) color = "var(--destructive)";

  return (
    <span style={{ color, fontWeight: 600, fontSize: 12 }}>
      {code}
      {label && <span style={{ fontWeight: 400, marginLeft: 4, fontSize: 11 }}>{label}</span>}
    </span>
  );
}
