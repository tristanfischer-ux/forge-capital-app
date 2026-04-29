# Port Plan: forge-capital-app layout → ForgeOS investor page

> **Goal:** Rearrange the ForgeOS investor profile page and match cards
> to use the same layout and information structure as forge-capital-app.
> Then add the few data sources that only exist on apex-outreach.
>
> **Scope:** Search + information display only. No outreach, no campaign
> tracking, no approval workflow. ForgeOS features that don't exist in
> forge-capital-app (tier gating, shortlist board, directory charts,
> file upload, view caps, similar investors, co-investment network,
> notes timeline) stay exactly as they are.

---

## What this actually is

Most of the data already exists in ForgeOS's `marketplace_listings`
table — thesis, sector, stage, geo, cheque, hardware fit, ideal
company profile, investment pattern, team expertise, partners. The
investor detail page already renders all of it. The work is:

1. **Rearrange the existing page** into the forge-capital-app layout
   (CollapsibleSections with §N numbering, FactStrip, same section
   order, closed/medium/full card states on match results)

2. **Add 4 data sources** that only exist on apex-outreach today
   (deep profiles, chunk evidence, recent news, personalised insight)

That's it. Simpler than the original plan suggested.

---

## Phase 1 — Layout rearrangement (no new data, just restructuring)

Everything below uses data ForgeOS already has in
`marketplace_listings.attributes` and `vc_pe_contacts`.

### 1a. Port CollapsibleSection component

Copy `CollapsibleSection.tsx` from forge-capital-app. Client component
with §N header, expand/collapse, gradient fade, "Show more" button.

**Create:** `src/app/(platform)/investors/[id]/components/CollapsibleSection.tsx`

### 1b. Restructure investor detail page into §-numbered sections

Current page has ~20 flat Card sections. Restructure to match
forge-capital-app's flow:

| § | Section | Data source (already in ForgeOS) |
|---|---|---|
| §1 | Recent news | *New — see Phase 2* |
| §2 | Thesis | `attributes.investment_thesis` (already rendered) |
| §3 | Ideal company profile + Value add | `attributes.ideal_company_profile` + `attributes.value_add` (already rendered) |
| §4 | Investment pattern + Recent activity | `attributes.investment_pattern` + `attributes.recent_deals_summary` (already rendered) |
| §5 | Connection brief | `attributes.connection_brief` (already rendered, pro-gated) |
| §6 | Partners | `vc_pe_contacts` via `KeyPeopleSection` (already rendered, tier-gated) |
| §7 | Deep dossier | *New — see Phase 2* |
| §8 | Source evidence | *New — see Phase 2* |

**Work:** Wrap §2-§6 in `CollapsibleSection` with appropriate
`previewLines`. Reorder sections to match the table above. The
existing content rendering stays — just the wrapper changes.

**Modify:** `src/app/(platform)/investors/[id]/page.tsx`

### 1c. Add FactStrip (3 inline cards at top)

Compact summary strip: Key Facts | Focus | Provenance. All data
already exists in `marketplace_listings.attributes`.

**Create:** `src/app/(platform)/investors/[id]/components/FactStrip.tsx`

### 1d. Match card states — closed / medium / full

Current ForgeOS has a single card state with an expand accordion.
Refactor to three states matching forge-capital-app:

- **Closed** (default): rank + firm name + type chip + composite % +
  hardware fit badge + 2-line thesis excerpt + stage/sector/cheque
  chips + save button. All data already available.
- **Medium** (click to expand): everything from closed + 6-pillar
  score bars + full thesis + sector tags + "Why / How to pitch"
  accordion. All data already available.
- **Full**: the investor detail page (navigate to `/investors/[id]`).

**Work:** Extract the inline `MatchCard` function from
`InvestorDeckSearchClient.tsx` into its own file. Add a `cardState`
prop (closed/medium). Click card → toggle medium. Click "View full
profile →" → navigate.

**Create:** `src/app/(platform)/investors/components/MatchCard.tsx`
**Modify:** `src/app/(public-investors)/investors/components/InvestorDeckSearchClient.tsx`

### 1e. Scoring alignment

Align ForgeOS weights to forge-capital-app's 7-dimension system:
thesis×20 + stage×20 + geo×15 + cheque×15 + activity×15 + data×10 +
hardware×15 = /110.

Add `ideal_company_profile` to the thesis Jaccard bag (already done
in forge-capital-app).

**Modify:** `src/lib/investor-match.ts`, `MatchPillarBars.tsx`

**Estimate for Phase 1:** ~2-3 days. No external dependencies. Can
start immediately.

---

## Phase 2 — Add the 4 missing data sources from apex-outreach

These are the only pieces that require cross-project data access.
ForgeOS reads from `jyarhvinengfyrwgtskq`; these 4 features need
data from `kgkajatjyqfetdtbzmwg` (apex-outreach).

### 2a. Data bridge setup (prerequisite)

Add `APEX_SUPABASE_URL` and `APEX_SERVICE_ROLE_KEY` to ForgeOS
Vercel env. Create a server-side helper `createApexClient()`.

**Create:** `src/lib/supabase/apex-client.ts`
**Vercel env:** 2 new variables (server-side only, never exposed to client)

### 2b. Recent news (§1)

Fetch `investor_deep_profiles.profile_json.recent_news` from
apex-outreach. Port `RecentNewsBlock` component (renders news items
with regex-extracted "Source ↗" links).

The bridge between the two Supabase projects is `forge_capital_id`
on `marketplace_listings` → `investor_id` on `investor_deep_profiles`.

**Create:** `src/app/(platform)/investors/[id]/components/RecentNewsBlock.tsx`
**Data:** `investor_deep_profiles` on apex-outreach (8,227 of 14,396 investors covered)

### 2c. Deep dossier (§7)

Fetch the full `profile_json` from apex-outreach: investment thesis
(deep version), recent investments, fund details, team, quality
assessment, fact checks, sources. Port the `DeepDossierContent`
renderer.

**Modify:** `src/app/(platform)/investors/[id]/page.tsx`
**Data:** Same `investor_deep_profiles` table as 2b

### 2d. Source evidence (§8)

Port `SourceEvidence.tsx`. Reads the founder's hero text (from URL
`?q=` param in ForgeOS, not sessionStorage), embeds it, calls
`match_chunks_for_investor` RPC on apex-outreach, shows top 8
matching excerpts from scraped website pages with URLs and match %.
Includes the "indexing in progress" state for investors whose chunks
haven't been pushed yet.

**Create:** `src/app/(platform)/investors/[id]/components/SourceEvidence.tsx`
**Server action:** Add `getChunkEvidence` to `src/actions/investors.ts`
**Data:** `investor_page_chunks` on apex-outreach (864,975 chunks, push completing tonight)

### 2e. Personalised insight ("Why they might back you" / "How to pitch")

ForgeOS already has `enrichInvestorMatchOnDemand` which does something
similar. Update its prompt to match forge-capital-app's (which produces
better, more specific output). Wire it into the profile page via a
client component.

**Modify:** `src/actions/investors.ts` (prompt update)
**Modify:** `src/app/(platform)/investors/[id]/page.tsx` (add section)

**Estimate for Phase 2:** ~1-2 days. Depends on Phase 2a (data bridge)
completing first. 2b-2e can run in parallel after that.

---

## Phase 3 — Partner data gap-fill (small)

ForgeOS's `vc_pe_contacts` is already richer than forge-capital-app's
`partners_mirror` (has seniority, warm intro path, decision-maker
badge, contact detail dialog). The only gap:

1. **Coverage check** — run a comparison to find investors that have
   partners in `partners_mirror` (53,365 rows) but no contacts in
   `vc_pe_contacts`. If gaps exist, extend the push script.
2. **Add `focus_areas`** column to `vc_pe_contacts` if missing (1,940
   partners have this in forge-capital-app).
3. **Keep existing ForgeOS partner UI** — it's already better than
   forge-capital-app's rendering (tier gating, contact detail dialog,
   seniority display). No layout changes needed.

**Estimate:** Half a day.

---

## Execution order

```
Phase 1 — Layout rearrangement (2-3 days, no dependencies)
  ├─ 1a. Port CollapsibleSection
  ├─ 1b. Restructure detail page into §-numbered sections
  ├─ 1c. Add FactStrip
  ├─ 1d. Refactor match cards to closed/medium/full
  └─ 1e. Align scoring weights

Phase 2 — Add 4 data sources (1-2 days, after 2a)
  ├─ 2a. Data bridge setup (APEX env vars + client)
  ├─ 2b. Recent news (§1)
  ├─ 2c. Deep dossier (§7)
  ├─ 2d. Source evidence (§8)
  └─ 2e. Personalised insight prompt upgrade

Phase 3 — Partner gap-fill (half day, independent)
  ├─ Coverage comparison
  ├─ Add focus_areas column
  └─ Extend push script if needed
```

**Total: ~4-5 days.** Phase 1 can start immediately. Phase 2 needs
the Vercel env vars set first (agent can do this autonomously).
Phase 3 is independent.

---

## Files summary

### New files (6)
| File | Purpose |
|---|---|
| `src/lib/supabase/apex-client.ts` | Cross-project Supabase client |
| `src/app/(platform)/investors/[id]/components/CollapsibleSection.tsx` | §N expand/collapse |
| `src/app/(platform)/investors/[id]/components/FactStrip.tsx` | 3-card summary strip |
| `src/app/(platform)/investors/[id]/components/RecentNewsBlock.tsx` | News with source links |
| `src/app/(platform)/investors/[id]/components/SourceEvidence.tsx` | Chunk-level website evidence |
| `src/app/(platform)/investors/components/MatchCard.tsx` | Closed/medium card states |

### Modified files (5)
| File | Change |
|---|---|
| `src/app/(platform)/investors/[id]/page.tsx` | Restructure to §-numbered CollapsibleSections, add FactStrip + new sections |
| `src/app/(public-investors)/investors/components/InvestorDeckSearchClient.tsx` | Use extracted MatchCard component |
| `src/actions/investors.ts` | Add `getChunkEvidence`, update insight prompt |
| `src/lib/investor-match.ts` | Align scoring weights |
| `src/app/(platform)/investors/components/MatchPillarBars.tsx` | Update labels if needed |

### Vercel env (2, server-side only)
| Variable | Purpose |
|---|---|
| `APEX_SUPABASE_URL` | apex-outreach project URL |
| `APEX_SERVICE_ROLE_KEY` | apex-outreach service role key |

---

## What stays as-is in ForgeOS

All existing ForgeOS features are preserved:

- Tier gating, view caps, shortlist board, file upload, directory
  charts, near-miss grouping, similar investors, co-investment
  network, data panorama, notes timeline, contact detail dialog,
  breadcrumb navigation, search telemetry

These are ForgeOS features that serve the multi-tenant product.
The port only changes the layout and adds the 4 data sources from
today's forge-capital-app work.
