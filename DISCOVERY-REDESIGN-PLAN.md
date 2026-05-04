# Discovery Page Redesign Plan

> **Goal:** Make the Discovery page a pure search-and-select surface — find companies, select them, add to a campaign. No archetype selection, no campaign context, no investor/customer/supplier branching.

---

## What changes

### Remove
- **ArchetypeRow** (Investor / Customer / Supplier selector cards) — gone entirely
- **Archetype param** (`?a=investor|customer|supplier`) — removed from page.tsx
- **AutoSuggestBanner** (detects archetype from text, suggests switching) — gone
- **Lookalike tab** (needs campaignId, uses positive-signal respondents) — removed from Discover page; stays on pipeline if needed
- **ConflictBanner** (warns about investors in other campaigns) — removed from search results; checked at "add to campaign" time instead
- **Campaign-specific hero text persistence** — single localStorage key, not per-campaign
- **customer_campaign_partners query** — no longer needed on discover page
- **listActiveCampaigns** fetch on server — moved to AddToCampaignBar only

### Keep (simplified)
- **PitchInput** — textarea for describing what you're looking for (relabelled "Find Investors" → "What are you looking for?")
- **DumpInfoBox** — drag-and-drop file upload for deck extraction
- **FilterBar** — Stage, Geography, Type, Cheque Size filters (unchanged)
- **ResultCard** — individual investor results with scorecard (unchanged)
- **BatchBar** — sticky selection bar for shortlisting (simplified)
- **ResultsHead** — tabs for Best match, Thesis only, Near-miss (simplified, remove Lookalikes)
- **AddToCampaignBar** — select N investors and add to a campaign (enhanced)

### Add
- **Checkbox multi-select** on each ResultCard — tick investors individually
- **"Select all visible" / "Select top N"** controls in the BatchBar
- **Persistent selection count** — "300 selected" visible at all times
- **"Add N selected to campaign"** button at the bottom (sticky)

---

## Layout (top to bottom)

```
┌─────────────────────────────────────────────────┐
│  Find Investors                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ [textarea - what you're looking for]      │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  [Climate tech, Seed, UK] [AI drug discovery]   │
│                                                 │
│  ┌──────────────────┐ ┌──────────────────┐      │
│  │ 📄 Upload file   │ │ 📋 Paste text    │      │
│  │    PDF, PPTX     │ │    Exec summary  │      │
│  └──────────────────┘ └──────────────────┘      │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │              Search                       │  │
│  └───────────────────────────────────────────┘  │
│  [Clear search — show all investors]            │
├─────────────────────────────────────────────────┤
│  Filters                                        │
│  STAGE        GEOGRAPHY   TYPE    CHEQUE  SORT  │
│  [Any Stage]  [All Geo]   [All]   [Any]   [▾]  │
├─────────────────────────────────────────────────┤
│  9,642 match filters  2,361 strong matches      │
│  ☐ Select all  |  Select top [100▾]  32 selected│
├─────────────────────────────────────────────────┤
│  1. Epidarex Capital  VC    71.9% MATCH  ☐     │
│     Thesis ████░░░░  Stage ██████████  ...      │
│     [tags: Biotechnology, medical devices]       │
│                                                 │
│  2. O2H Ventures       VC    71.4% MATCH  ☐    │
│     ...                                         │
│                                                 │
│  3. UK Innovation Fund Gov   67.7% MATCH  ☐    │
│     ...                                         │
│                                                 │
│  [Load more]                                    │
├─────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────┐  │
│  │  32 selected  →  Add to campaign [▾]  →  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Implementation steps

### Step 1: Remove archetype layer from page.tsx
**File:** `app/(authed)/discover/page.tsx`
- Remove `archetype` parsing from search params
- Remove `listCustomerCampaignPartners()` call
- Simplify server-side data to just: `getMatchScore()` + `listActiveCampaigns()` (for AddToCampaignBar only)
- Pass simplified props to DiscoverClient

### Step 2: Remove archetype UI from FindAMatch
**File:** `app/(authed)/match/FindAMatch.tsx`
- Remove `ArchetypeRow` component and its import
- Remove `AutoSuggestBanner` component and its import
- Remove `archetype` state and related handlers
- Hardcode `archetype="investor"` in the `findMatches` call (the scoring engine still needs an archetype internally)
- Remove `archetype` from the search params in the URL

### Step 3: Simplify ResultsHead tabs
**File:** `app/(authed)/match/FindAMatch.tsx`
- Remove "Lookalikes" tab (requires campaignId)
- Keep: Best match, Thesis only, Near-miss (3 tabs instead of 4)

### Step 4: Convert filters to multi-select
**File:** `app/(authed)/match/FindAMatch.tsx` (FilterBar within)
- Replace single-select dropdowns with multi-select checkbox dropdowns
- Each filter (Stage, Geography, Type, Cheque Size) supports selecting multiple values
- Default: all selected (no filtering)
- Filter logic: OR within a category (e.g. "VC" OR "Angel"), AND across categories (e.g. "VC" AND "UK")
- Visual: pill chips showing selected values, dropdown with checkboxes
- Sort stays single-select (no change needed)

### Step 5: Add checkbox multi-select to ResultCard
**File:** `app/(authed)/match/FindAMatch.tsx` (ResultCard within)
- Add a checkbox to each ResultCard
- Track `selectedIds: Set<number>` in parent state
- Checkbox toggles individual ID in/out of set

### Step 6: Enhance BatchBar with selection controls
**File:** `app/(authed)/match/FindAMatch.tsx` (BatchBar within)
- Show "Select all visible" checkbox
- Show "Select top [N]" dropdown (100, 200, 300, 500)
- Show count: "32 selected"
- "Add to campaign" button wired to AddToCampaignBar

### Step 7: Update AddToCampaignBar
**File:** `app/(authed)/discover/AddToCampaignBar.tsx`
- Accept `selectedInvestorIds` instead of `scoredInvestorIds` (user-selected, not just scored)
- Campaign selector dropdown (keep existing)
- Show count: "Add 32 investors to [Campaign ▾]"
- On submit: bulk-insert selected IDs into `campaign_partners`

### Step 8: Update DiscoverClient
**File:** `app/(authed)/discover/DiscoverClient.tsx`
- Remove archetype-related state
- Pass `selectedIds` state between FindAMatch and AddToCampaignBar
- Simplify the bridge — FindAMatch manages selection, AddToCampaignBar receives the set

### Step 9: Simplify hero text persistence
**File:** `app/(authed)/match/FindAMatch.tsx`
- Use single localStorage key `"heroText"` instead of per-campaign keys
- Remove campaign-scoped sessionStorage logic

---

## What stays unchanged
- **Scoring engine** (`lib/queries/match-score.ts`) — unchanged, still scores against full investor pool
- **FilterBar** — same 5 filters, same logic
- **ResultCard layout** — same scorecard, same tags, same expand/collapse
- **AddToCampaignBar server action** (`addMatchesToCampaign`) — same bulk-insert logic
- **Pipeline page** — untouched. Once investors are added to a campaign, the pipeline page shows status (contacted, approved, etc.)

---

## Risks and mitigations
1. **Breaking existing campaigns** — campaigns created before this change still work. The only change is how investors get added (checkbox selection vs. batch top-N). Existing `campaign_partners` rows are unaffected.
2. **Hardcoded archetype="investor"** in findMatches call — the scoring engine uses archetype for dimension weighting. Since discovery is now pure investor-finding, this is correct. Customer/supplier matching would need a separate surface if ever needed.
3. **Performance** — checkbox selection is client-side, no DB calls. Only the "add to campaign" action writes to DB.
