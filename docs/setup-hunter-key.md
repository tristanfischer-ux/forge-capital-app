# Hunter.io API key — existing location

The Hunter API key is already configured at:
  /Users/tristanfischer/Developer/Forge-Capital/.env

(This is the sibling Forge Capital pipeline repo — the SQLite-based investor
outreach project. The key is set there as `HUNTER_API_KEY` and used by the
overnight pipeline for email verification / email finder calls.)

It is NOT currently present in this app's `.env.local`, nor in Vercel
(production or preview) environment. `vercel env ls production | grep -i hunter`
and `vercel env ls preview | grep -i hunter` both returned nothing.

To make it available to this app:
  - Copy the line from the sibling project's `.env` into this app's `.env.local`:
      `echo "HUNTER_API_KEY=<value>" >> /Users/tristanfischer/Developer/forge-capital-app/.env.local`
    (Tristan pastes the value — the secret is deliberately not included in this doc.)
  - Also set it in Vercel so preview + production deploys can verify emails:
      `cd /Users/tristanfischer/Developer/forge-capital-app`
      `vercel env add HUNTER_API_KEY production`
      `vercel env add HUNTER_API_KEY preview`

Once set, the `sendGmailMessage` path automatically uses Hunter
(`lib/email/verify-deliverability.ts`); no code change required.

Verify:
  `curl "https://api.hunter.io/v2/email-verifier?email=hello@example.com&api_key=$HUNTER_API_KEY"`
should return `data.status`.
