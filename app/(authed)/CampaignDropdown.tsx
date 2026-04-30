"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CampaignSummary } from "@/lib/queries/campaigns";
import {
  computeCampaignWeek,
  counterpartLabel,
} from "@/lib/queries/campaigns-shared";
import { EditCampaignPanel } from "./campaigns/EditCampaignPanel";

/**
 * Campaign switcher — 1:1 port of V4 `.campaign-switcher` +
 * `.camp-dropdown` (Phase2-Mockup-V4.html lines 735-836).
 *
 * V4 class vocabulary:
 *   - `.campaign-switcher`            — the pill trigger
 *   - `.campaign-switcher .label`     — "Campaign" muted caption
 *   - `.campaign-switcher .name`      — bold indigo campaign name
 *   - `.type-badge` + `.type-badge-inv|cus|sup` — intent badge
 *   - `.campaign-switcher .caret`     — ▾ glyph
 *   - `.camp-dropdown`                — floating menu (we add `.open`
 *                                       when the trigger is clicked)
 *   - `.camp-dropdown .group-label`   — "Your campaigns · N active"
 *   - `.camp-opt` + `.camp-opt.active`— one row per campaign
 *   - `.camp-opt .dot` + `.d-ss|ff|fg|ca|me|uk|pt|sp` — intent colour
 *   - `.camp-opt .txt` / `.n` / `.s` / `.ct` / `.mini-type`
 *   - `.camp-dropdown .divider`       — between intent groups
 *   - `.camp-dropdown .new-link`      — "+ New campaign" footer row
 *
 * Behaviour:
 *  - Shows the active campaign name + intent badge in the pill.
 *  - Clicking the pill opens the dropdown (toggles `.open` class).
 *  - Each option is a Next `<Link>` — selecting one swaps `?c=<uuid>`
 *    on the tracker so the server component refetches for the new
 *    campaign, and writes the `fc_active_campaign` cookie so the
 *    sidebar rail follows.
 *  - Groups by intent (investor → customer → supplier) with dividers.
 */
export function CampaignDropdown({
  campaigns,
  activeCampaignId,
  totalActive,
}: {
  campaigns: CampaignSummary[];
  activeCampaignId: string | null;
  totalActive: number;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Outside-click + Escape close. Only wired when open to avoid listener
  // churn on every render.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active =
    campaigns.find((c) => c.id === activeCampaignId) ?? campaigns[0] ?? null;

  // Empty state — no campaigns visible (RLS denied). Layout surfaces the
  // sign-in hint separately; returning null here keeps the topbar clean.
  if (!active) return null;

  // Group by intent so we can render the V4 dividers exactly.
  const investors = campaigns.filter((c) => c.campaign_intent === "investor");
  const customers = campaigns.filter((c) => c.campaign_intent === "customer");
  const suppliers = campaigns.filter((c) => c.campaign_intent === "supplier");

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {/* V4 line 735-741: .campaign-switcher with dot, label, name,
          type-badge, caret. Inline style on the dot matches V4 line 736
          (8px indigo circle). */}
      <div
        className="campaign-switcher"
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span
          className="dot"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--accent)",
          }}
          aria-hidden="true"
        />
        <span className="label">Campaign</span>
        <span className="name">{active.name}</span>
        <span className={`type-badge ${intentBadgeClass(active.campaign_intent)}`}>
          {intentLabel(active.campaign_intent)}
        </span>
        <span className="caret">&#9662;</span>
      </div>

      {/* Pencil button — opens the edit panel for the active campaign.
          Separate from the main switcher click so Tristan can type
          the real counterpart name himself (no more hardcoded "Stephan"). */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
          setOpen(false);
        }}
        title={`Edit ${active.name}`}
        aria-label={`Edit ${active.name}`}
        style={{
          position: "absolute",
          top: -2,
          right: -10,
          width: 22,
          height: 22,
          border: "1px solid var(--border)",
          borderRadius: "50%",
          background: "var(--surface)",
          color: "var(--text-dim)",
          fontSize: 11,
          cursor: "pointer",
          lineHeight: 1,
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ✎
      </button>

      {editing ? (
        <EditCampaignPanel
          campaign={active}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {/* V4 line 747-836: .camp-dropdown (floating panel). V4 uses
          `.open` class; we mount conditionally instead — same visual
          outcome. */}
      {open ? (
        <div
          className="camp-dropdown open"
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
          }}
        >
          <div className="group-label">
            <span>Your campaigns</span>
            <span style={{ color: "var(--text-faint)" }}>
              {totalActive} active
            </span>
          </div>

          {investors.map((c) => (
            <CampaignOption key={c.id} campaign={c} active={c.id === active.id} />
          ))}

          {investors.length > 0 && (customers.length > 0 || suppliers.length > 0) ? (
            <div className="divider" />
          ) : null}

          {customers.map((c) => (
            <CampaignOption key={c.id} campaign={c} active={c.id === active.id} />
          ))}

          {customers.length > 0 && suppliers.length > 0 ? (
            <div className="divider" />
          ) : null}

          {suppliers.map((c) => (
            <CampaignOption key={c.id} campaign={c} active={c.id === active.id} />
          ))}

          <div className="divider" />
          {/* "+ New campaign" — V4 line 835. Disabled in V1 until
              campaign creation ships. */}
          <div
            className="new-link"
            title="Campaign creation lands in a later section"
            style={{ opacity: 0.7, cursor: "not-allowed" }}
            aria-disabled="true"
          >
            <span style={{ fontSize: 16, lineHeight: 0.8 }}>+</span> New
            campaign
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One campaign row in the dropdown — V4 `.camp-opt` markup verbatim
 * (lines 750-758). Dot uses V4's `d-ss|ff|fg|ca|me|uk|pt|sp` palette;
 * we pick one deterministically from the campaign id's first char so
 * the colours stay stable across renders without a migration adding a
 * dedicated colour column.
 */
function CampaignOption({
  campaign,
  active,
}: {
  campaign: CampaignSummary;
  active: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/home";

  // Stay on the user's current page when switching campaigns. Clicking
  // a campaign used to force-navigate to /tracker — jarring when the
  // user was on /home or any other section. Now we:
  //   1. Write the `fc_active_campaign` cookie client-side so next
  //      SSR read picks it up.
  //   2. Push the current pathname with `?c=<uuid>` so page-level
  //      reads that honour the query param refresh immediately.
  //   3. router.refresh() to invalidate the cached RSC tree so the
  //      top-bar campaign label and sidebar re-render with the new
  //      cookie value (without this, the label stays stale until the
  //      next full navigation).
  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `fc_active_campaign=${campaign.id}; path=/; max-age=${maxAge}; samesite=lax`;
    // Include the destination campaign's archetype in the URL so the
    // Find-a-Match surface re-renders on the correct pool + hero text.
    // Previously only `?c=` was set, which meant the server component
    // fell back to "investor" archetype on every switch, regardless of
    // whether the new campaign was investor / customer / supplier.
    const arch =
      campaign.campaign_intent === "customer" ? "customer"
      : campaign.campaign_intent === "supplier" ? "supplier"
      : "investor";
    const target = `${pathname}?c=${campaign.id}&a=${arch}`;
    router.push(target);
    router.refresh();
  }

  const dotClass = pickDotClass(campaign.id);
  const miniType = intentBadgeClass(campaign.campaign_intent);

  // Fallback href for the no-JavaScript case — matches the onClick
  // destination so a direct click without JS still lands correctly.
  const fallbackHref = `${pathname}?c=${campaign.id}`;

  return (
    <Link
      href={fallbackHref}
      onMouseDown={onClick}
      onClick={(e) => e.preventDefault()}
      className={active ? "camp-opt active" : "camp-opt"}
      role="option"
      aria-selected={active}
    >
      <span className={`dot ${dotClass}`} aria-hidden="true" />
      <div className="txt">
        <div className="n">
          {campaign.name}{" "}
          <span className={`mini-type ${miniType}`}>
            {intentLabel(campaign.campaign_intent)}
          </span>
        </div>
        {/* V4 `.s` subtitle: "Archetype · counterpart · week N of M".
            Counterpart name + week come from the campaign row (migration
            012 added counterpart_name; week_started_at + week_count_target
            were present earlier). Both are optional — when either is null
            we drop the segment honestly rather than render placeholders. */}
        <div className="s">{campaignSubtitle(campaign)}</div>
      </div>
      <div className="ct">{campaign.partner_count.toLocaleString("en-GB")}</div>
    </Link>
  );
}

function intentLabel(intent: CampaignSummary["campaign_intent"]): string {
  if (intent === "investor") return "Investor";
  if (intent === "customer") return "Customer";
  return "Supplier";
}

function intentBadgeClass(intent: CampaignSummary["campaign_intent"]): string {
  if (intent === "investor") return "type-badge-inv";
  if (intent === "customer") return "type-badge-cus";
  return "type-badge-sup";
}

function archetypeCopy(intent: CampaignSummary["campaign_intent"]): string {
  if (intent === "investor") return "Money in · sell equity";
  if (intent === "customer") return "Money in · sell product";
  return "Money out · buyer posture";
}

function campaignSubtitle(campaign: CampaignSummary): string {
  const parts = [archetypeCopy(campaign.campaign_intent)];
  if (campaign.counterpart_name?.trim()) {
    parts.push(counterpartLabel(campaign, "title"));
  }
  const week = computeCampaignWeek(campaign);
  if (week) parts.push(`Week ${week.current} of ${week.total}`);
  return parts.join(" · ");
}

/**
 * V4's dropdown gives each campaign its own coloured dot — `.d-ss`,
 * `.d-ff`, `.d-pt`, `.d-fg`, `.d-ca`, `.d-me`, `.d-uk`, `.d-sp` are
 * hard-coded per-campaign in the mockup (v4-mockup.css lines 599-606).
 * V1 has no persisted colour per campaign, so we pick from the palette
 * deterministically by hashing the id — stable across renders, stable
 * across refreshes.
 */
const DOT_PALETTE = [
  "d-ss",
  "d-ff",
  "d-fg",
  "d-ca",
  "d-me",
  "d-uk",
  "d-pt",
  "d-sp",
] as const;

function pickDotClass(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return DOT_PALETTE[Math.abs(h) % DOT_PALETTE.length];
}
