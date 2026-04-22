# forge-capital-app — agent rules

This codebase is a mockup-faithful port of Phase2-Mockup-V4.html. Every
rule below is load-bearing. Violations are what produced the mess
Tristan called out on 2026-04-21 evening. The rules exist because we
already paid the cost of ignoring them.

## Phase — we are past the port, now enhancing (2026-04-22)

Tristan called this explicitly: *"I think we've reached a stage where
we shouldn't be doing mock-ups and we should be just changing the app
directly; otherwise, we're going to have too much of a loop. The key
part of what it looks like is already done, and now we are in the
enhancing stage of the app. Let's do everything now directly into the
new app rather than having a mock-up."*

So — for this codebase, the global CLAUDE.md "Mockup before code" rule
is suspended. When Tristan asks for a new feature or enhancement:

1. Build it directly in the React app. No standalone HTML mockup.
2. Keep using V4 class names + the existing CSS design tokens — the
   visual vocabulary is locked. A new section gets V4-style `.section`
   / `.section-head` / `.section-title` / `.section-sub` chrome unless
   Tristan explicitly asks for something new.
3. Parity-gate rules still apply for any change that RE-TOUCHES an
   existing V4 section — don't break the port while adding things.
4. If the enhancement is genuinely novel (not an extension of any V4
   section — e.g. a whole new data-model concept that needs UI
   design), STOP and ask Tristan if he wants a mockup. Default is no.

Re-enable mockup-first ONLY if Tristan explicitly says so, or the
whole app is being redesigned again.

## The spec is V4. Full stop.

- **The mockup is the spec.** Not a reference. Not a vibe. The spec.
- **Files in the spec** (all in `~/Developer/Forge-Capital/audit-20260421/`):
  - `Phase2-Mockup-V4.html` — 3,034-line HTML, the full single-page design
  - `v4-reference/outreach-forge-v4-full.jpg` — Tristan's own 1265×9060 export
  - `v4-reference/01-project-home.png` — top-of-page crop
  - `v4-reference/02-project-home-full-scroll.png` — with approval gate visible
- **Served locally for agent-browser** at `http://localhost:8765/Phase2-Mockup-V4.html`
  when the Python HTTP server is running in `audit-20260421/`. Start it with
  `cd audit-20260421 && python3 -m http.server 8765` if it isn't up.

## Use V4's CSS directly — it's already imported

**`app/v4-mockup.css`** contains V4's entire `<style>` block, lifted verbatim.
It's imported at the top of `app/globals.css`. This means every class
name V4 uses — `.topbar`, `.brand`, `.topnav .pill`, `.campaign-switcher`,
`.hero`, `.hero-input`, `.arch-card`, `.arch-ico`, `.arch-row`,
`.auto-suggest`, `.conflict-banner`, `.batch-bar`, `.results-head`,
`.result-card`, `.match-score`, `.dim-bars`, `.approval-grid`,
`.approval-col`, `.bpm-row`, `.bpm-body`, `.template-card`,
`.review-stack`, `.review-card`, `.ver-card`, `.gmail-draft-item`,
`.wk-stat`, `.chart-card`, `.walk-tour-strip` — **is live in production.**

**The port workflow is therefore:**

1. Read the V4 HTML section (e.g. lines 913-1147 for Find a Match)
2. **Copy the DOM structure verbatim** into a React component — same
   tag types, same class names, same child order.
3. Replace V4's hard-coded dummy data (names, counts, paragraphs) with
   real Supabase queries.
4. Copy V4's visible copy strings verbatim — never paraphrase.
5. Verify with a screenshot. Visual match is by construction; the
   screenshot is a bug-check, not a re-specification.

**You do not write new Tailwind classes to approximate V4 styles.** The
styles are already here. If a V4 element looks wrong in production,
the fix is "did I use the right class name?", not "let me re-derive a
Tailwind equivalent".

**When V4 is revised**, re-extract with:
`sed -n '49,714p' audit-20260421/Phase2-Mockup-V4.html > forge-capital-app/app/v4-mockup.css`
(adjust line range if V4's `<style>` block boundaries move).

## Never read the mockup via grep alone

- **Before touching code, RENDER V4 in agent-browser.** Not a line-range
  excerpt; not a summary. Load the real page at 1440×900 and look at it.
- Reading HTML with grep shows structure, not gestalt. Gestalt is what
  makes the product feel right. You cannot port gestalt from a line
  range.
- If you're about to paste a V4 line range into a sub-agent brief WITHOUT
  also pointing them at the served mockup or a screenshot of the relevant
  section, stop. You're about to repeat the 2026-04-21 failure.

## Never distil V4 into a "decisions doc" that replaces V4

- `V4-FEATURE-DECISIONS.md` exists in `audit-20260421/`. It lists data-model
  and behaviour decisions. **It does not describe what the page looks like.**
- Sub-agent briefs must point at the **mockup first**, decisions doc second.
  Decisions doc is a supplement, not a substitute.
- If a decisions-style doc disagrees with V4, V4 wins unless Tristan has
  explicitly overridden in writing.

## Parity gate — MANDATORY on every commit that touches rendered UI

No commit message without a parity summary. No push until the diff is ✓.

1. Open V4 in agent-browser at the local server URL. Navigate to the
   section you're porting. Screenshot at 1440×900 **with the `--full`
   flag** to `/tmp/v4-<section>.png`. Viewport-only screenshots hide
   90% of single-scrolling-page content and are the #1 cause of false
   "parity ✓" claims.
2. Open your production build at the same viewport. Screenshot
   **full-page** to `/tmp/prod-<section>.png`. Start the dev server
   with `env -i PATH=$PATH HOME=$HOME npm run dev` — a polluted shell
   (e.g. `NEXT_PUBLIC_SUPABASE_URL` pointing at another project) will
   silently override `.env.local` and ship a screenshot of the wrong
   backend's data.
3. Sanity-check both PNGs before claiming parity:
   - `sips -g pixelHeight /tmp/v4-*.png /tmp/prod-*.png` — heights
     should match within ~10%. >30% drift means content is missing.
   - `file /tmp/v4-*.png` — a <50KB PNG is almost always a 404 error
     page. Verify the Python http.server is rooted at
     `audit-20260421/` (`lsof -i :8765` + `ps aux | grep http.server`).
4. Read Tristan's reference images in `audit-20260421/v4-reference/` —
   these show the target with populated real data.
5. Diff section-by-section: for every `<section>`, card, tile, callout,
   button, badge, pill in V4 — is it present in production? Same copy?
   Same spacing? Same colour family?
6. **Log the diff in the commit message** — what matches (✓), what is off
   and by how much (⚠). A commit with ⚠ entries must be iterated before
   push.

If agent-browser can't screenshot (auth, infra), say so in the report.
Don't silently commit claiming parity.

### Dev-only auth bypass for screenshot sub-agents

Every authed route in this app lives behind middleware that redirects
unauthed traffic to `/?next=<path>`. For sub-agents taking parity
screenshots, magic-link email is not an option.

Mechanism: set `DEV_SKIP_AUTH=1` in `.env.local` (it's already
documented, commented-out, in `.env.local.example`). When active, the
middleware mints a real Supabase session for `tristan.fischer@gmail.com`
via admin-generate-link → verifyOtp, writes the `sb-<ref>-auth-token`
cookie on the response, and lets the request through as if the user
signed in. Implementation in `lib/dev-auth.ts`, wired at the top of
`middleware.ts`.

How to use it for a parity screenshot run:
```
echo "DEV_SKIP_AUTH=1" >> .env.local   # once; or uncomment the example line
npm run dev
agent-browser open http://localhost:3000/home --headless
agent-browser screenshot -c
```
The `/home` request will transparently authenticate the test user and
render as if Tristan signed in.

Belt-and-braces guarantee: the flag is inert in production. The check is
`NODE_ENV !== "production" && DEV_SKIP_AUTH === "1"` — both conditions
must be true. A production env variable leak alone cannot activate it.
The `lib/dev-auth.ts` module short-circuits at its exported guard; the
middleware short-circuits at the same guard. Never remove either check.

Never commit `.env.local`. Never export `DEV_SKIP_AUTH` in Vercel env
config.

## Architecture — locked

- **V4 is one scrolling page.** Not multi-route. The 8 topbar pills are
  anchor-scroll targets (#find-a-match, #approval, #automation, etc.),
  not separate pages.
- `/` after auth renders the V4 single-page home with every built
  section stacked. `/tracker`, `/match`, `/tracker/[id]/draft` remain
  as deep-link views of individual sections, useful for sharing URLs.
- Right sidebar (`app/(authed)/Sidebar.tsx`) is persistent across the
  home and all sub-routes.

## Section ownership

V4 is decomposed into sections per the locked port plan
(`audit-20260421/V4-PORT-PLAN.md`). Each sub-agent owns ONE section.
Sub-agents must not touch other sections' files. If a shared component
is needed (TierBadge, StatusBadge, SectionHead), it lives in
`app/(authed)/` — shared. Editing shared components requires noting in
the commit message which sections rely on them.

## Data wiring — every number must be real

- V4 shows "9,642 active investors". That's a real count. Render the
  real current count from Supabase. If it's 9,349 today, show 9,349.
- V4 shows "In approval queue: 34". Render the real count (count of
  `campaign_partners` where `status_code IN ('+0', '+1')` for the
  active campaign).
- **Never hard-code numbers that have a real data source.** V4 placeholders
  are V4's problem; in production they must resolve to live data.
- For genuine placeholders with no V1 data source yet (e.g. "Next
  auto-batch run: Tue 09:00" before the cron scheduler lands), render
  the V4 copy verbatim AND add an in-code comment + a title-attribute
  tooltip flagging "wires to X in Phase Y". Never hide the debt.
- **Empty states use V4's vocabulary, not generic Tailwind filler.**
  When a Supabase query returns zero rows, render "No activity recorded
  yet — contact events will populate once the Gmail sync runs" (i.e. a
  sentence that names the specific pipeline stage) rather than
  "No data". The empty-state copy IS product copy and has to feel like
  Tristan wrote it. If V4 doesn't show an empty state for that card,
  invent one in the same tone and commit the string alongside the
  component.
- **Copy varies by `campaigns.campaign_intent`.** Subject and noun
  choices are data-driven: "fundraise update" (investor),
  "buyer pipeline update" (customer), "supplier update" (supplier).
  Don't hardcode investor-specific words — route every display string
  through the intent. The weekly composer (`research/17-compose-weekly-draft.py`)
  and the draft composer (`app/(authed)/tracker/[campaignPartnerId]/draft/compose.ts`)
  both do this; follow the same pattern in any new surface.

## Copy rules — no invention

- Every visible string in V4 appears verbatim in the production build
  unless the real data replaces it. Don't paraphrase.
- British spelling ("organise", "behaviour", "programme").
- Light theme only. Never dark.
- Fischer spelled with a c-h. Not Fisher.
- No "AI-powered" / "Smart" / "Intelligent" marketing verbs.
- Sign-offs from REAL-TEMPLATES-FROM-GMAIL.md are Tristan's actual voice.
  Don't invent new ones.

## Sub-agent concurrency — sequential for V4 sections

- V4 section ports touch the single-page composer in `/` eventually.
- Running two V4-section sub-agents in parallel creates merge races on
  the home page / shared sidebar / shared shell.
- Run V4 sections ONE AT A TIME. Wait for each to land and be reviewed
  for parity before dispatching the next.
- Data-plumbing / DB-only / non-UI sub-agents (sync scripts, polish
  scripts, cron work) can run in parallel with V4-section ports because
  they touch different files.

## git discipline

- `git add <specific files>` only — NEVER `git add -A`. The
  concurrent-agent race from 2026-04-21 taught us why.
- Commit messages include: parity diff summary (for UI commits),
  reference screenshots, co-author line
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Never push when Tristan is reviewing a commit — the main thread
  owns pushes.
- Don't flip a repo from private to public without stating the decision
  in the commit message.

## Infrastructure — full control, no clickthroughs

Tristan has authorised the agent to act directly on:

- **Vercel** — the `vercel` CLI is already logged in as him. Use it for
  env vars (`vercel env add/rm/ls`), deploys (`vercel --prod`,
  `vercel inspect`), domain config, project settings. Never tell
  Tristan "go to the Vercel dashboard and paste X" — execute it.
- **Supabase** — project `kgkajatjyqfetdtbzmwg` (apex-outreach) is
  reachable via the `mcp__claude_ai_Supabase__*` MCP tools: migrations
  via `apply_migration`, raw SQL via `execute_sql`, edge functions via
  `deploy_edge_function`, storage/policies the same way. Never tell
  Tristan to open the SQL editor.

**Third-party services that still need Tristan's own login** (no CLI
or MCP): Google Cloud Console (OAuth consent screens), Replicate
(only for signup + initial token — once the token exists, Vercel env
is the agent's job), Stripe, Gmail Workspace admin. When Tristan hands
over a secret for one of these, the agent installs it across Vercel
envs + local `.env.local` + any code wiring + verifies end-to-end —
Tristan's handover is the last manual step.

Codified 2026-04-22 after Tristan flagged it: "You have full control
over Vercel. Please do not ask me to do Vercel. Claude.md should have
very clear instructions that you have full control over Vercel and
you have full control over Supabase."

## Lessons learned — what worked (verified 2026-04-22)

The HTML-as-code port approach succeeded. Parity scan of `/home` vs
`Phase2-Mockup-V4.html`: prod 8,037px vs V4 8,436px (within 5%), all
10 sections present in the correct order with matching colour family
and typography stack. The weekly section's SVG line + stacked-bar
charts render from real `campaign_partners` / `contact_events` data
with empty-state copy when data is absent. Subject-line variation by
`campaign_intent` works end-to-end (SkySails → "fundraise update";
Fischer Farms Customer → "buyer pipeline update").

What made it work, kept together so a future port doesn't have to
re-discover:

1. **Extract V4's `<style>` block once** —
   `sed -n '49,714p' audit-20260421/Phase2-Mockup-V4.html > app/v4-mockup.css`
   (adjust line range if V4 is revised). Import it at the top of
   `app/globals.css` **before** `@tailwind base` — otherwise PostCSS
   errors on `@import must precede all other rules`.
2. **Class names come from V4, not Tailwind.** `.topbar`, `.brand`,
   `.hero`, `.wk-stat`, `.chart-card`, `.weekly-grid-stats` — all
   live in `v4-mockup.css`. Writing Tailwind approximations is the
   failure mode that cost 2026-04-21. Don't re-derive.
3. **Empty states are part of the design.** Every real-data surface
   should also ship an empty-state variant in the same tone (see
   "Copy rules" above). The weekly section's "No activity recorded
   yet — contact events will populate once the Gmail sync runs" is
   the reference pattern.
4. **The parity gate catches screenshot scams.** `--full` flag + PNG
   height sanity check + `env -i` clean shell are the three things
   that prevent "I took a viewport screenshot of the wrong Supabase
   backend and called it parity ✓."
5. **Single scrolling page with anchor pills is the architecture.**
   Don't multi-route. `/tracker`, `/match`, `/weekly` stay as shareable
   deep-links of individual sections but `/home` is the canonical view.

## Why this file exists

On 2026-04-21, after four rounds of mockup work on V4, I (Claude, this
agent's previous self) built a version of the app that Tristan looked
at and said: *"This doesn't look anything like the app which we were
looking at in terms of the mock-ups."*

The failure chain, in order:
1. Distilled V4 into a "feature decisions" doc that became the spec
2. Never rendered V4 in a browser — only grepped for structure
3. Shipped Next.js routes instead of V4's single scrolling page
4. Used "mockup-faithful" as a wish, not a gate
5. Mistook "functional + tests pass" for "done"
6. Reported progress that sounded complete while the visual product
   was a skeleton

Every rule above maps to one of those failures. If you skip a rule,
you're re-introducing the bug.

## Autonomous work when Tristan is away

If the terminal has been silent for a while and you have remaining tasks
that don't require Tristan's input, **keep working.** Don't stop because
the user isn't here. Don't stop because "the current chunk is done". The
standing instruction is: there is always something you can do on the
list — a pending task, a known follow-up, a polish item, a test, a doc
update, an investigation.

**When you hit a genuine blocker** (credential you don't have, subjective
decision, external login): accumulate it in the handover doc
(`audit-20260421/V4-PORT-COMPLETE-20260421.md` currently, or a
`BLOCKERS.md` at repo root if that grows) then pick a different task
and continue.

**Stop only when:**
1. The task list is genuinely empty, OR
2. Every remaining task depends on Tristan's input (you've queued them
   cleanly with a "blocked on X" note), OR
3. You'd be doing speculative/destructive work without his sign-off.

**When Tristan returns:** lead with what got done and what's blocked. Never
hide behind "I wasn't sure what to do next." There was always something.

See global `~/.claude/CLAUDE.md` §"Autonomous work when Tristan is away"
for the canonical version of this rule.

## Related docs to read on session start

- `~/Developer/Forge-Capital/audit-20260421/V4-PORT-PLAN.md` — section order + parity gate
- `~/Developer/Forge-Capital/audit-20260421/STATUS-20260421-END-OF-DAY.md` — current live state
- `~/Developer/Forge-Capital/audit-20260421/Outreach-Writing-Rules-TF.md` — Tristan's voice rules
- `~/Developer/Forge-Capital/audit-20260421/REAL-TEMPLATES-FROM-GMAIL.md` — verbatim templates
