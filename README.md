# forge-capital-app

Fractional Forge's investor and customer outreach tracker. Replaces the Excel-based workflow with a Next.js + Supabase web app. Reader/writer over a central Supabase DB that the local Forge Capital pipeline pushes into nightly — the app does not run scrapers or the enrichment pipeline itself.

## Status

Phase 0 scaffold. Magic-link login placeholder, no feature code yet.

## Run locally

```bash
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

Open http://localhost:3000.

## Structure

- `app/` — Next.js 16 App Router pages
- `lib/supabase/` — browser, server, and admin Supabase clients
- `supabase/migrations/` — numbered SQL migrations (001 through 007)
- `seed/` — JSON seed files for campaigns and email templates

## Build plan

See `/Users/tristanfischer/Developer/Forge-Capital/audit-20260421/BUILD-PLAN-FORGE-CAPITAL-APP.md` for the full phasing, data model, and MVP definition.

## House rules

- Light theme only. No dark mode anywhere.
- British spelling ("programme", "organise", "behaviour").
- "Fractional Forge" the company, "ForgeOS" the product (ForgeOS is a sibling project, not this one).
- "Fischer" with a c-h. Always.
- No marketing claims like "AI-powered" in product copy.
- Template copy is verbatim from Tristan's sent mail — never invent outreach copy.
