# Dual Supabase seam

The raise book lives on **ForgeOS Corpus** (`fnusjztykxibqybuekvh`, schemas `core` and `engage`). Google login and Gmail/Calendar OAuth tokens still live on **apex-outreach** (`kgkajatjyqfetdtbzmwg`) so reconnecting Google mid-raise was not required.

That split is intentional until auth is moved. It is not two books. The book is Corpus. kgkajat holds:

- Supabase Auth (allow-list `tristan.fischer@gmail.com`)
- `gmail_tokens`
- The old encyclopaedia (`investors_mirror` / `partners_mirror`) used only as a fallback

Writers on Corpus set `created_by` to `app` or `cowork`. Excel is a download. Nothing auto-sends.

Gmail and Calendar sync:

- Vercel Cron hits `/api/cron/gmail-sync` and `/api/cron/calendar-sync` every 15 minutes with `CRON_SECRET`
- An authed **Sync now** button posts to `/api/desk-sync` so a pull does not need this laptop
