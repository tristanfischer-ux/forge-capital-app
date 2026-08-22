# Phase 1 — gates real. Report.

Orders: `GROK_BUILD_SCOPE_AND_ORDERS_2026-08-22.md`. Phase 2 not started.

## 1. Numbers before

| Measure | Before |
|---|---|
| People | 3,753 |
| `email_state = verified` | **1** |
| Participations `approached` | 930 |
| Participations `approved` | 394 |
| `engage.email_drafts` | 0 |
| `engage.audit_log` where `actor = app` | **0** (52 rows, all cowork) |
| `sync_state.neverbounce.last_ok_at` | never |
| `sync_state.export.last_ok_at` | never |

## 2. Numbers after

| Measure | After |
|---|---|
| `check_outreach_allowed` on an approved unverified row | `allowed: false`, reason `Rule 13: email not NeverBounce-verified (state: unknown)` |
| UPDATE that row to `approached` | **blocked**, verbatim `BLOCKED (Rule 13): email not NeverBounce-verified (state: unknown)` (`P0001`) |
| `email_drafts` insert (test row, then deleted) | succeeded; table count still 0 |
| `audit_log` `actor = app` | **1** (the acceptance test write) |
| Desk draft paths (`chasers`, `outreach`, `meeting`, `send/book-actions`) | write `engage.email_drafts`, **not** `activities.channel = draft` |
| Sent-mail sweep | `/api/cron/sent-sweep` every 15 minutes. Marks `sent_at`, writes `email_out`, then `advanceToApproached` (trigger-enforced) |
| Export heartbeat | `/api/cron/export` 02:00 UTC. Builds the workbook in memory and `bumpSyncState('export')`. Storage upload is Phase 6 |
| `forge.backfill` | not set by the app |

`neverbounce` / `export` `last_ok_at` still **never** until those crons fire on production. Code paths exist; they have not yet run unattended.

## 3. Acceptance test run

`scripts/phase1-gates.mjs` against live Corpus (`fnusjztykxibqybuekvh`):

1. RPC `check_outreach_allowed` on approved + unverified.
2. UPDATE `stage = approached` on the same row.
3. INSERT `email_drafts` + `audit_log` actor `app`, then delete the dummy draft.
4. Confirm no `forge.backfill`.

## 4. Result

**PASS** the four tests above.

**Not yet passing as a complete Phase 1 on production:** neverbounce and export heartbeats still `never` until the new crons run. Sent-mail sweep has not yet observed a real send (zero live `email_drafts`).

**Stop.** Phase 2 (NeverBounce backfill of 1,664 addresses) is not started. It remains the unblock for any useful draft. Of the 394 approved-never-written, the desk can still legally draft **one** person until Phase 2 runs.
