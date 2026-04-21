"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CampaignSummary } from "@/lib/queries/campaigns";

/**
 * Campaign switcher — port of Phase2-Mockup-V4.html `.campaign-switcher` +
 * `.camp-dropdown` (V4 lines ~735–836). Replaces the previous chip-row.
 *
 * Behaviour:
 *  - Shows the active campaign name + intent badge in the pill.
 *  - Clicking the pill opens the dropdown.
 *  - Each option is a `<Link>` — selecting one swaps `?c=<uuid>` on the
 *    current path so the server component refetches for the new campaign.
 *  - Groups campaigns by intent (investor, customer, supplier) with a
 *    divider between groups, matching the V4 spec exactly.
 *  - Options are rendered in investor → customer → supplier order so the
 *    divider semantics match V4 regardless of DB sort order.
 *
 * Client component: needs local open/close state + outside-click close.
 * We keep it thin — all campaign data arrives as a prop from the server.
 */
export function CampaignDropdown({
  campaigns,
  activeCampaignId,
}: {
  campaigns: CampaignSummary[];
  activeCampaignId: string | null;
}) {
  const [open, setOpen] = useState(false);
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

  const active = campaigns.find((c) => c.id === activeCampaignId) ?? campaigns[0] ?? null;

  // Group by intent so we can render section dividers exactly like V4.
  // The V4 dropdown groups investor first, then customer, then supplier.
  const investors = campaigns.filter((c) => c.campaign_intent === "investor");
  const customers = campaigns.filter((c) => c.campaign_intent === "customer");
  const suppliers = campaigns.filter((c) => c.campaign_intent === "supplier");
  const totalActive = campaigns.length;

  // V4 pill: indigo softer bg, rounded-full, with label + active name +
  // type badge + caret. Keep inline styles minimal and rely on tokens.
  if (!active) {
    // Empty state — no campaigns visible at all (RLS denied). The layout
    // surfaces the sign-in hint separately; here we render nothing so the
    // topbar still lays out cleanly.
    return null;
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded-full border border-[#e4e1ff] bg-accent-softer px-3.5 py-1.5 pr-3 text-[12px] font-medium text-accent"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className="block h-2 w-2 rounded-full bg-accent"
          aria-hidden="true"
        />
        <span className="text-text-dim">Campaign</span>
        <span className="font-semibold text-accent">{active.name}</span>
        <IntentBadge intent={active.campaign_intent} size="sm" />
        <span className="text-[10px]">&#9662;</span>
      </button>

      {open ? (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-[80] w-[360px] rounded-[12px] border border-border bg-surface p-2 shadow-lg"
          role="listbox"
        >
          <GroupLabel label="Your campaigns" count={`${totalActive} active`} />
          {investors.map((c) => (
            <CampaignOption
              key={c.id}
              campaign={c}
              active={c.id === active.id}
            />
          ))}

          {investors.length > 0 && customers.length > 0 ? <Divider /> : null}
          {customers.map((c) => (
            <CampaignOption
              key={c.id}
              campaign={c}
              active={c.id === active.id}
            />
          ))}

          {customers.length > 0 && suppliers.length > 0 ? <Divider /> : null}
          {(investors.length > 0 && suppliers.length > 0 && customers.length === 0) ? <Divider /> : null}
          {suppliers.map((c) => (
            <CampaignOption
              key={c.id}
              campaign={c}
              active={c.id === active.id}
            />
          ))}

          <Divider />
          <div
            className="flex cursor-default items-center gap-2 rounded-[6px] px-2.5 py-2 text-[12px] font-semibold text-text-faint"
            title="Campaign creation lands in a later section"
          >
            <span className="text-[16px] leading-none">+</span>
            New campaign
            <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-text-faint">
              Later
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GroupLabel({ label, count }: { label: string; count: string }) {
  return (
    <div className="flex items-center justify-between px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-text-faint">
      <span>{label}</span>
      <span>{count}</span>
    </div>
  );
}

function Divider() {
  return <div className="my-1.5 h-px bg-border-soft" aria-hidden="true" />;
}

/**
 * One campaign row in the dropdown. V4: small dot + name + intent badge +
 * subtitle (empty in V1 — we have no founder/counterpart column yet) +
 * partner count. Active row gets indigo-softer bg.
 */
function CampaignOption({
  campaign,
  active,
}: {
  campaign: CampaignSummary;
  active: boolean;
}) {
  // Cookie the selection so the authed layout's Sidebar (server component)
  // can resolve which campaign is active for its health cards without
  // needing to read search params (layouts don't receive searchParams in
  // Next 16). The cookie is a 1-year convenience — the URL's `?c=` still
  // wins for any page-level query.
  function onClick() {
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `fc_active_campaign=${campaign.id}; path=/; max-age=${maxAge}; samesite=lax`;
  }

  return (
    <Link
      href={`/tracker?c=${campaign.id}`}
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 py-2 hover:bg-accent-light ${
        active ? "bg-accent-softer" : ""
      }`}
      role="option"
      aria-selected={active}
    >
      <span
        className={`block h-2 w-2 shrink-0 rounded-full ${
          campaign.campaign_intent === "investor"
            ? "bg-accent"
            : campaign.campaign_intent === "customer"
              ? "bg-green"
              : "bg-amber"
        }`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-text">
          <span className="truncate">{campaign.name}</span>
          <IntentBadge intent={campaign.campaign_intent} size="xs" />
        </div>
      </div>
      <div className="shrink-0 font-mono text-[11px] tabular-nums text-text-faint">
        {campaign.partner_count}
      </div>
    </Link>
  );
}

/**
 * Shared intent badge used in the topbar pill + dropdown rows. `sm` is
 * the one in the pill; `xs` is the mini variant inside the dropdown row.
 * Tokens mirror V4 `.type-badge-inv|cus|sup`.
 */
function IntentBadge({
  intent,
  size,
}: {
  intent: "investor" | "customer" | "supplier";
  size: "sm" | "xs";
}) {
  const byIntent = {
    investor:
      "bg-intent-investor-bg text-intent-investor-fg border-intent-investor-border",
    customer:
      "bg-intent-customer-bg text-intent-customer-fg border-intent-customer-border",
    supplier:
      "bg-intent-supplier-bg text-intent-supplier-fg border-intent-supplier-border",
  } as const;
  const label = {
    investor: "Investor",
    customer: "Customer",
    supplier: "Supplier",
  } as const;
  const sizing =
    size === "sm"
      ? "text-[10px] px-1.5 py-0.5"
      : "text-[9px] px-1.5 py-[1px]";
  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold uppercase tracking-wide ${byIntent[intent]} ${sizing}`}
    >
      {label[intent]}
    </span>
  );
}
