# launchd agents — forge-capital-app

macOS `launchd` plist templates for daemons that run on Tristan's Mac
against this repo. Real plists (with secrets inlined) are gitignored;
only `.example` templates are committed.

## Prerequisite — Gmail OAuth reconnect

`calendar-sync.mjs` needs the `https://www.googleapis.com/auth/calendar.readonly`
scope. That scope was added to `GMAIL_SCOPES` after the initial Gmail
integration, so if Tristan linked Gmail before that change landed his
refresh token does not cover calendar reads. The sync script will
silently fetch zero events until this is fixed.

Reconnect flow:

1. Open the app while logged in.
2. Visit `/api/auth/gmail` to re-run the OAuth consent screen.
3. Approve the calendar read scope when Google prompts.

Details: `docs/reconnect-gmail-oauth.md`.

## calendar-sync — install

Runs `scripts/calendar-sync.mjs` every 10 minutes, reading Tristan's
primary Google Calendar and writing matching events into
`contact_events` for rows that correspond to a partner in
`partners_mirror`. Dedup is handled by a unique partial index on
`contact_events.google_calendar_event_id` (migration 024).

```bash
# 1. Copy the template to a real plist (gitignored).
cp ops/launchd/com.forgecapital.calendar-sync.plist.example \
   ops/launchd/com.forgecapital.calendar-sync.plist

# 2. Open the new file and replace every
#    <!-- PASTE YOUR <VAR> HERE --> placeholder with the real value
#    from .env.local:
#      NEXT_PUBLIC_SUPABASE_URL
#      SUPABASE_SERVICE_ROLE_KEY
#      GMAIL_CLIENT_ID
#      GMAIL_CLIENT_SECRET
#    (the PATH value already points at /opt/homebrew/bin — leave it.)

# 3. Copy the real plist into LaunchAgents and load it.
cp ops/launchd/com.forgecapital.calendar-sync.plist \
   ~/Library/LaunchAgents/

launchctl load ~/Library/LaunchAgents/com.forgecapital.calendar-sync.plist

# 4. Confirm it is registered (PID + exit-status appear once it runs).
launchctl list | grep forgecapital

# 5. Watch runs live. The first run fires at load (RunAtLoad=true),
#    then every 600 seconds after.
tail -f /private/tmp/fc-calendar-sync.log
```

## calendar-sync — unload / uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.forgecapital.calendar-sync.plist
rm ~/Library/LaunchAgents/com.forgecapital.calendar-sync.plist
```

## Editing the plist after install

If you change the plist (new env var, different interval), you MUST
unload and reload — `launchctl` caches the loaded definition.

```bash
launchctl unload ~/Library/LaunchAgents/com.forgecapital.calendar-sync.plist
cp ops/launchd/com.forgecapital.calendar-sync.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.forgecapital.calendar-sync.plist
```

## Node path

The template uses `/opt/homebrew/bin/node` (Homebrew on Apple Silicon).
If Tristan moves to a different Node install (nvm, asdf, volta) update
the first entry of `ProgramArguments` and the `PATH` env var.

## Why the plist is gitignored

The real plist inlines `SUPABASE_SERVICE_ROLE_KEY` and
`GMAIL_CLIENT_SECRET`. Committing it would leak production credentials
into git history. The `.example` version stays checked in as the
template; the real `.plist` lives only on Tristan's Mac.
