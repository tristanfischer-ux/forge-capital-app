"use client";

import { useEffect, useState } from "react";
import type { CrossCampaignInvestor } from "@/lib/queries/cross-campaign-investors";

/**
 * Cross-campaign Master Investor Tracker — web equivalent of the Excel spreadsheet.
 * Shows every investor Tristan has ever reached out to, with per-campaign status.
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
      (inv.contact_name ?? "").toLowerCase().includes(q) ||
      (inv.sector ?? "").toLowerCase().includes(q)
    );
  });

  const overlapCount = investors.filter((i) => i.overlap_count > 1).length;

  return (
    <div style={{ padding: "24px 32px" }}>
      {/* Section header — V4 style */}
      <div className="section-head" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="section-title" style={{ fontSize: 22, fontWeight: 700 }}>
            Master Investor Tracker
          </h2>
          <p className="section-sub" style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}>
            Every investor you have ever reached out to, across all campaigns.
          </p>
        </div>
      </div>

      {/* Summary tiles */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <StatTile label="Total Investors" value={investors.length} />
        <StatTile label="Campaigns" value={campaignNames.length} />
        <StatTile label="Overlapping" value={overlapCount} />
        <StatTile
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
          placeholder="Search by firm name, contact, or sector..."
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

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Investor</th>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Contact</th>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Sector</th>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>HQ</th>
              {campaignNames.map((name) => (
                <th key={name} style={{ padding: "8px 12px", fontWeight: 600, minWidth: 120 }}>
                  {name}
                </th>
              ))}
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Overlap</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inv) => (
              <>
                <tr
                  key={inv.investor_id}
                  onClick={() => setExpandedId(expandedId === inv.investor_id ? null : inv.investor_id)}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                    background: inv.overlap_count > 1 ? "rgba(255, 69, 0, 0.04)" : undefined,
                  }}
                >
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>
                    {inv.firm_name}
                    {inv.entity_type && (
                      <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 6 }}>
                        {inv.entity_type}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px" }}>{inv.contact_name ?? "—"}</td>
                  <td style={{ padding: "8px 12px", color: "var(--text-dim)" }}>{inv.sector ?? "—"}</td>
                  <td style={{ padding: "8px 12px", color: "var(--text-dim)" }}>{inv.hq_location ?? "—"}</td>
                  {campaignNames.map((name) => {
                    const cs = inv.campaigns.find((c) => c.campaign_name === name);
                    return (
                      <td key={name} style={{ padding: "8px 12px" }}>
                        {cs ? (
                          <StatusCell status={cs.status_code} label={cs.status_label} days={cs.days_since} />
                        ) : (
                          <span style={{ color: "var(--text-faint)" }}>—</span>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ padding: "8px 12px", fontWeight: inv.overlap_count > 1 ? 700 : 400 }}>
                    {inv.overlap_count > 1 ? (
                      <span style={{ color: "var(--orange)" }}>{inv.overlap_count}</span>
                    ) : (
                      <span>{inv.overlap_count}</span>
                    )}
                  </td>
                </tr>
                {/* Expanded commentary row */}
                {expandedId === inv.investor_id && (
                  <tr key={`${inv.investor_id}-detail`}>
                    <td colSpan={4 + campaignNames.length + 1} style={{ padding: "12px 16px", background: "var(--surface-alt, #f8f9fa)" }}>
                      <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                        {inv.thesis_summary && (
                          <p style={{ marginBottom: 8 }}>
                            <strong>Thesis:</strong> {inv.thesis_summary}
                          </p>
                        )}
                        {inv.campaigns.map((cs) => (
                          <div key={cs.campaign_id} style={{ marginBottom: 4 }}>
                            <strong>{cs.campaign_name}:</strong> {cs.status_label}{" "}
                            {cs.days_since !== null && `(${cs.days_since} days ago)`}
                            {cs.permission_status !== "not_required" && (
                              <span style={{ marginLeft: 8, color: cs.permission_status === "approved" ? "var(--success)" : cs.permission_status === "denied" ? "var(--destructive)" : "var(--warning)" }}>
                                Permission: {cs.permission_status}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>
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

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      padding: "12px 20px",
      background: "var(--surface)",
      borderRadius: 8,
      border: "1px solid var(--border)",
      minWidth: 120,
    }}>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
    </div>
  );
}

function StatusCell({ status, label, days }: { status: string | null; label: string | null; days: number | null }) {
  if (!status) return <span style={{ color: "var(--text-faint)" }}>—</span>;

  const code = parseInt(status.replace(/[^0-9-]/g, ""), 10);
  let color = "var(--text-dim)";
  if (code > 5) color = "var(--success)";
  else if (code > 0) color = "var(--accent)";
  else if (code < 0) color = "var(--destructive)";

  return (
    <div>
      <span style={{ color, fontWeight: 600, fontSize: 12 }}>{status}</span>
      {days !== null && (
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 4 }}>{days}d</span>
      )}
    </div>
  );
}
