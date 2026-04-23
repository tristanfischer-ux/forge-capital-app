# IMPROVEMENTS.md — streamline ideas surfaced by the Wren walkthrough

Tagged [BLOCKER] / [VALUE] / [NICE].


## DAY 0

- [VALUE] **No new-campaign UI in the app**. Today campaigns must be inserted via SQL or the pipeline. A founder onboarding flow at `/campaigns/new` (with the 6 fields: name, intent, description, raise_size, website, counterpart) would be a real win — it's the first thing a new user would expect.
- [NICE] **Section-title consistency**: Find-a-Match uses `.hero-title`, every other section uses `.section-title`. Either rename or add a small wrapping `.section-title` for nav/screenshot consistency.


## DAY 1

- [BLOCKER → fixed migration 019] HNSW ef_search default of 40 was capping every match query. The default scorer/Find-a-Match were producing 4-row results when the DB had 705 sector-relevant investors. Fixed.
- [VALUE] **No "no matches found" empty state with diagnostics**. When the result set was 4, the UI showed 4 cards with no signal that something might be wrong. A "Showing 4 of 1,000 scored — broaden criteria?" honest empty/thin-state would have surfaced the bug from the user side.
