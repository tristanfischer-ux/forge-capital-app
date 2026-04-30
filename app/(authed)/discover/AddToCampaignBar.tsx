"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CampaignSummary } from "@/lib/queries/campaigns";

/**
 * "Add to campaign" bar — bridges Discovery (truth DB) → Pipeline
 * (personal DB). After the user searches and finds matches, they pick
 * a target campaign, choose how many top results to inject, and click
 * "Add to campaign". The server action bulk-inserts campaign_partners
 * rows, then redirects to /pipeline#approval.
 *
 * V4 CSS: uses `.section` for the container + inline styles matching
 * the V4 surface / border / accent palette.
 */
export function AddToCampaignBar({
  campaigns,
}: {
  campaigns: CampaignSummary[];
}) {
  const router = useRouter();
  const [selectedCampaign, setSelectedCampaign] = useState(
    campaigns[0]?.id ?? "",
  );
  const [count, setCount] = useState(100);
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    if (!selectedCampaign) return;
    setAdding(true);
    // TODO: wire server action to bulk-insert top N scored investors
    // into campaign_partners for the selected campaign with
    // status_code = '+0' (pending approval).
    //
    // For now, navigate to the pipeline page for the selected campaign.
    router.push(`/pipeline?c=${selectedCampaign}`);
  }

  if (campaigns.length === 0) return null;

  return (
    <section
      className="section"
      style={{
        marginTop: 24,
        padding: "20px 24px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "var(--shadow)",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text)",
          marginBottom: 12,
        }}
      >
        Add top matches to a campaign
      </h3>
      <p
        style={{
          margin: "0 0 16px",
          fontSize: 13,
          color: "var(--text-dim)",
          lineHeight: 1.55,
        }}
      >
        Select a campaign and choose how many of the highest-scoring
        matches to add. They will appear in your pipeline as pending
        approval.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
        {/* Campaign picker */}
        <div style={{ flex: "1 1 240px" }}>
          <label
            htmlFor="add-campaign-select"
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 500,
              color: "var(--text-dim)",
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Target campaign
          </label>
          <select
            id="add-campaign-select"
            value={selectedCampaign}
            onChange={(e) => setSelectedCampaign(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: 13,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface)",
              color: "var(--text)",
            }}
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.campaign_intent})
              </option>
            ))}
          </select>
        </div>

        {/* Count input */}
        <div style={{ flex: "0 0 120px" }}>
          <label
            htmlFor="add-count-input"
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 500,
              color: "var(--text-dim)",
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Top matches
          </label>
          <input
            id="add-count-input"
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: 13,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface)",
              color: "var(--text)",
            }}
          />
        </div>

        {/* Add button */}
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !selectedCampaign}
          style={{
            flex: "0 0 auto",
            padding: "8px 20px",
            fontSize: 13,
            fontWeight: 600,
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: adding ? "wait" : "pointer",
            opacity: adding ? 0.7 : 1,
          }}
        >
          {adding ? "Adding…" : "Add to campaign"}
        </button>
      </div>
    </section>
  );
}
