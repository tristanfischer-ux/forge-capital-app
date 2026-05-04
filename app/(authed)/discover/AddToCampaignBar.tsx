"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CampaignSummary } from "@/lib/queries/campaigns";
import { addMatchesToCampaign } from "./actions";
import {
  getPartnerOutreachState,
  type OutreachState,
} from "../pipeline/outreach-state-actions";

/**
 * "Add to campaign" bar — bridges Discovery (truth DB) → Pipeline
 * (personal DB). After the user searches and finds matches, they pick
 * a target campaign, choose how many top results to inject, and click
 * "Add to campaign". The server action bulk-inserts campaign_partners
 * rows with status_code = '+0' (pending approval).
 *
 * V4 CSS: uses `.section` for the container + inline styles matching
 * the V4 surface / border / accent palette.
 */
export function AddToCampaignBar({
  campaigns,
  selectedInvestorIds,
}: {
  campaigns: CampaignSummary[];
  selectedInvestorIds: number[];
}) {
  const [selectedCampaign, setSelectedCampaign] = useState(
    campaigns[0]?.id ?? "",
  );
  const [count, setCount] = useState(100);
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<{
    added: number;
    skipped: number;
    campaignName: string;
  } | null>(null);
  const [crossCampaignWarning, setCrossCampaignWarning] = useState<{
    total: number;
    byCampaign: { name: string; count: number }[];
  } | null>(null);

  // Check cross-campaign state when scored IDs or selected campaign change
  useEffect(() => {
    if (selectedInvestorIds.length === 0) {
      setCrossCampaignWarning(null);
      return;
    }
    let cancelled = false;
    const checkIds = selectedInvestorIds.slice(0, 500);
    getPartnerOutreachState(checkIds)
      .then((states: OutreachState[]) => {
        if (cancelled) return;
        const otherCampaign = states.filter(
          (s) =>
            s.total_campaigns_active > 0 &&
            s.relationship_status !== "new" &&
            s.last_campaign_id !== selectedCampaign,
        );
        if (otherCampaign.length === 0) {
          setCrossCampaignWarning(null);
          return;
        }
        const buckets = new Map<string, number>();
        for (const s of otherCampaign) {
          const name = s.last_campaign_name ?? "another campaign";
          buckets.set(name, (buckets.get(name) ?? 0) + 1);
        }
        const byCampaign = Array.from(buckets.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);
        setCrossCampaignWarning({ total: otherCampaign.length, byCampaign });
      })
      .catch(() => setCrossCampaignWarning(null));
    return () => {
      cancelled = true;
    };
  }, [selectedInvestorIds, selectedCampaign]);

  const selectedName =
    campaigns.find((c) => c.id === selectedCampaign)?.name ?? "campaign";

  async function handleAdd() {
    if (!selectedCampaign || selectedInvestorIds.length === 0) return;
    setAdding(true);
    setResult(null);

    const idsToAdd = selectedInvestorIds.slice(0, count);

    try {
      const res = await addMatchesToCampaign({
        campaignId: selectedCampaign,
        investorIds: idsToAdd,
      });
      setResult({
        added: res.added,
        skipped: res.skipped,
        campaignName: selectedName,
      });
    } catch (err) {
      console.error("Failed to add matches:", err);
    } finally {
      setAdding(false);
    }
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
        {selectedInvestorIds.length > 0
          ? `${selectedInvestorIds.length.toLocaleString("en-GB")} investors selected. Pick a campaign and click Add to push them into your pipeline as pending approval.`
          : "Search and tick investors above, then add them to a campaign."}
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "end",
          flexWrap: "wrap",
        }}
      >
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
            onChange={(e) => {
              setSelectedCampaign(e.target.value);
              setResult(null);
            }}
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
            max={Math.max(selectedInvestorIds.length, 1)}
            value={count}
            onChange={(e) => {
              setCount(Number(e.target.value));
              setResult(null);
            }}
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
          disabled={adding || !selectedCampaign || selectedInvestorIds.length === 0}
          style={{
            flex: "0 0 auto",
            padding: "8px 20px",
            fontSize: 13,
            fontWeight: 600,
            background:
              selectedInvestorIds.length === 0 ? "var(--border)" : "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor:
              adding || selectedInvestorIds.length === 0 ? "not-allowed" : "pointer",
            opacity: adding ? 0.7 : 1,
          }}
        >
          {adding ? "Adding…" : "Add to campaign"}
        </button>
      </div>

      {/* Cross-campaign warning */}
      {crossCampaignWarning && crossCampaignWarning.total > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: "#fffbeb",
            border: "1px solid #f59e0b",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.55,
            color: "var(--text)",
          }}
        >
          <strong style={{ color: "#b45309" }}>⚠ Cross-campaign overlap:</strong>{" "}
          {crossCampaignWarning.total.toLocaleString("en-GB")} of these investors
          were already contacted for other campaigns
          {crossCampaignWarning.byCampaign.length > 0 && (
            <span style={{ color: "var(--text-dim)" }}>
              {" "}
              ({crossCampaignWarning.byCampaign
                .slice(0, 3)
                .map((b) => `${b.count} for ${b.name}`)
                .join(", ")}
              {crossCampaignWarning.byCampaign.length > 3 ? ", …" : ""})
            </span>
          )}
          . You can still proceed — this is informational only.
        </div>
      )}

      {/* Result feedback */}
      {result && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 16px",
            background: "var(--surface-alt, #f0f7ff)",
            border: "1px solid var(--accent)",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.55,
            color: "var(--text)",
          }}
        >
          {result.added > 0 ? (
            <>
              <strong>
                Added {result.added.toLocaleString("en-GB")} investor
                {result.added !== 1 ? "s" : ""} to {result.campaignName}.
              </strong>
              {result.skipped > 0 && (
                <span style={{ color: "var(--text-dim)" }}>
                  {" "}
                  {result.skipped.toLocaleString("en-GB")} already in campaign.
                </span>
              )}
              <br />
              <Link
                href={`/pipeline?c=${selectedCampaign}#approval`}
                style={{
                  color: "var(--accent)",
                  fontWeight: 600,
                  textDecoration: "none",
                  marginTop: 4,
                  display: "inline-block",
                }}
              >
                View in pipeline →
              </Link>
            </>
          ) : (
            <span style={{ color: "var(--text-dim)" }}>
              All {result.skipped.toLocaleString("en-GB")} investors are already
              in {result.campaignName}. No new additions.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
