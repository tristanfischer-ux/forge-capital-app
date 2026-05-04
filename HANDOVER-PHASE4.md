# Handover — forge-capital-app — Phase 4 Permission Workflow

**Repo:** `/Users/tristanfischer/Developer/forge-capital-app`
**Remote:** `tristanfischer-ux/forge-capital-app`
**Supabase project:** `kgkajatjyqfetdtbzmwg` (apex-outreach)
**HEAD:** `880e1ca` (Phase 4 — Excel export/import permission workflow) — DEPLOYED

---

## What was built this session

Phase 4 implementation is **committed and deployed** to production.

### Files committed (4 files, 750 insertions)
1. **`app/api/export-for-approval/route.ts`** — GET endpoint that queries `campaign_partners` at `+0` with `partners_mirror` + `investors_mirror`/`customers_mirror` joins, generates an `.xlsx` via SheetJS (`xlsx` package, already in dependencies), and streams it as a download.

2. **`app/(authed)/pipeline/import-approval-actions.ts`** — Server action `importApprovalDecisions()` that parses an uploaded `.xlsx`, matches rows by partner name + firm name (case-insensitive, with partner-only fallback), updates `status_code` to `+1` (yes) or `-1` (no), and calls `sync_investor_outreach_state()`.

3. **`app/(authed)/pipeline/ApprovalExcelButtons.tsx`** — Client component with "Export for approval" and "Import decisions" buttons. Export opens the API route in a new tab. Import uses a file picker → base64 → server action flow with result summary.

4. **`app/(authed)/pipeline/page.tsx`** — Added `ApprovalExcelButtons` import and rendered it below the Approval section inside `<div id="approval">`.

### What works
- TypeScript compiles cleanly (`npm run typecheck` passes)
- Next.js build succeeds (`npx next build` passes)
- UI renders correctly (buttons visible in pipeline page)
- API route returns proper error responses (401 unauthenticated, 400 missing campaign, 404 no pending partners)

### What needs testing
- **End-to-end with a real session** — The export button triggers `window.open()` which sends cookies. With a valid session, the API should return the .xlsx file. The import flow (file picker → base64 → server action) should work once export is verified.
- **Production** — Vercel deploy is Ready. The export/import buttons should appear on fractionalforge.app pipeline page.

---

## Context: what just shipped (Phases 1–3)

The app was restructured from a single scrolling page into a two-page architecture (confirmed by 6-model council):

- **`/discover`** — truth database surface. Find a Match (semantic search over 14,398 investors), campaign-agnostic, no campaign switcher. Default post-login landing. Has "Add top N to campaign" bar that bulk-inserts scored investors into `campaign_partners`.
- **`/pipeline`** — personal database surface. Campaign switcher lives here. Sections: Approval, Automation, Templates, Review, Drafts, Tracker, Weekly, Gmail, Import, Inbox.
- **`/home`** — redirects to `/discover`.

### Phase 3 (just landed): cross-campaign awareness

- `investor_outreach_state` table (migration 020) with `sync_investor_outreach_state()` RPC
- 513 rows populated, 95 partners flagged across multiple campaigns
- AddToCampaignBar shows amber warning: "⚠ 12 of these investors were already contacted for other campaigns"
- TrackerTable shows "Also in: SkySails, FishFrom" badges per partner
- Auto-syncs after `addMatchesToCampaign` mutations

### Recent commits (oldest → newest)

| SHA | What |
|---|---|
| `2e2ccf7` | Fix PostgREST 1,000-row cap — paginated SQL function |
| `c31f18e` | Fix campaign switch — mousedown race + Suspense key invalidation |
| `c17d6b2` | Two-page architecture — `/discover` + `/pipeline` |
| `bbab302` | Phase 2 — `addMatchesToCampaign` server action |
| `f3df52d` | Phase 3 — `investor_outreach_state` + cross-campaign warnings |

---

## Phase 4: Permission workflow (Excel export/import)

This is Tristan's real-world process: he exports a list of pending investors from a campaign, sends the Excel to the company's founder (e.g. the SkySails Chief Executive Officer), they mark who is acceptable to contact, Tristan imports the decisions back.

### The flow to build

1. **Export button** on the pipeline page (near the Approval section). User selects a campaign → clicks "Export for approval" → browser downloads an `.xlsx` file.

2. **Excel contents:**
   - Column A: Partner name (from `partners_mirror`)
   - Column B: Firm name (from `investors_mirror` via partner's `investor_id`)
   - Column C: Why-them summary (from `campaign_partners.notes` or synthesised)
   - Column D: Email status (verified / pending / none)
   - Column E: **Decision** — blank, for the reviewer to fill in: "yes", "no", or "skip"
   - Column F: Reviewer notes — blank, for optional comments
   - Header row + campaign name in a title row above
   - Only include partners with `status_code = '+0'` (pending approval)

3. **Import button** — user uploads the completed Excel file back.

4. **Server action** parses the Excel:
   - "yes" → update `campaign_partners.status_code` to `'+1'` (approved), `status_label` to `'Approved'`
   - "no" → update to `'-1'` (declined), `status_label` to `'Declined'`
   - "skip" or blank → no change
   - Match rows by partner name + firm name (fuzzy match if needed)
   - Fire `sync_investor_outreach_state()` afterwards

5. **Feedback** — show summary: "12 approved, 3 declined, 5 skipped"

### Key files to read first

- `app/(authed)/pipeline/page.tsx` — pipeline compositor, where the export/import buttons go
- `app/(authed)/tracker/TrackerTable.tsx` — tracker rendering, recently modified for Phase 3
- `lib/queries/tracker.ts` — tracker data queries
- `app/(authed)/discover/actions.ts` — reference for how `addMatchesToCampaign` works
- `app/(authed)/pipeline/outreach-state-actions.ts` — cross-campaign state actions
- `supabase/migrations/020_investor_outreach_state.sql` — the sync function to call after import
- `next.config.ts` — check `serverExternalPackages` (currently has `officeparser`)

### Database tables involved

- `campaign_partners` — the rows being exported/imported. Key columns: `campaign_id`, `partner_id`, `status_code`, `status_label`, `notes`, `updated_at`
- `partners_mirror` — partner names/emails (join on `partner_id`)
- `investors_mirror` — firm names (join via `partners_mirror.investor_id`)
- `campaigns` — campaign metadata (name, intent)
- `investor_outreach_state` — must be synced after import

### Status codes reference

| Code | Label | Meaning |
|---|---|---|
| `+0` | Pending approval | Added but not yet reviewed |
| `+1` | Approved | Cleared to contact |
| `+2` | Drafted | Email drafted |
| `+3` | Sent | Email sent |
| `+6` | Reply | Received reply |
| `+7` | Meeting | Meeting scheduled |
| `-1` | Declined | Reviewer said no |
| `-2` | Not interested | Investor declined |
| `-3` | Disqualified | Removed from campaign |

### Implementation notes

- For Excel generation, use `exceljs` (npm package) — it's the most mature Node.js Excel library. Add to `serverExternalPackages` in `next.config.ts` if Vercel bundling fails.
- For Excel parsing on import, `exceljs` also handles reading.
- The export could be a server action that returns a base64-encoded buffer, or an API route that streams the file. API route is cleaner for file downloads.
- The `campaign_approvers` table exists (0 rows) — it was designed for external approver access via shared link. Phase 4 minimum viable product is just export/import Excel; wiring `campaign_approvers` for a web-based approval view is a stretch goal.
- British spelling in all user-facing copy. No acronyms.

### Unverified items from earlier phases

These should be browser-tested before or during Phase 4 work:
- 1,000-row paginated fix showing >1000 scored results on production
- Campaign switching end-to-end after the mousedown race fix
- Cross-campaign warning rendering on AddToCampaignBar

---

## Dev environment

```bash
# MUST use clean shell — polluted env vars override .env.local
env -i PATH=$PATH HOME=$HOME npm run dev
```

## Gotchas

- **PostgREST `.in()` URL-length trap** — thousands of IDs hit ~27KB URL limit. Use RLS-scoped select-all + app-side filter instead.
- **Supabase JS `.select()` caps at 1000 rows** — paginate with `.range()`.
- **`serverExternalPackages`** in `next.config.ts` — any package with dynamic imports (officeparser, potentially exceljs) needs to be listed here or Vercel function crashes on boot.
- **V4 CSS classes** are live in `app/v4-mockup.css` — use existing classes, don't re-derive styles.
- **`status_code` is a text column**, not integer — values are `'+0'`, `'+1'`, `'-1'` etc. with the sign as part of the string.
