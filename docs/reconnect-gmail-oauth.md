# Gmail OAuth reconnect — MANUAL STEPS

Open a browser, then:

1. Visit http://localhost:3000/api/auth/gmail
   (or on production: https://outreach.fractionalforge.com/api/auth/gmail).
2. You'll land on Google's OAuth consent screen.
3. Sign in with tristan.fischer@gmail.com if not already.
4. You'll see three scopes listed:
   - "Read, compose, send, and permanently delete all your email from Gmail" (gmail.compose + gmail.readonly)
   - "See events on all your calendars" (calendar.readonly) ← the new one
5. Click **Allow**.
6. You'll redirect back to the app. The scope upgrade is live.

Verify by querying Supabase:
  select scope from gmail_tokens limit 1;
String should include `https://www.googleapis.com/auth/calendar.readonly`.
