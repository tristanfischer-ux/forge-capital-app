/**
 * HQ-location → IANA timezone lookup.
 *
 * Partners have `partners_mirror.hq_location` as free text — "London,
 * UK", "Menlo Park, California", "Noordwijk", "NL". This helper maps
 * common strings to an IANA timezone identifier so the scheduled-send
 * dispatcher can compute a local-window UTC timestamp per recipient.
 *
 * Design doc: docs/design-scheduled-sends.md §Timezone resolution.
 *
 * Strategy: small regex table of known cities/regions. First match
 * wins. Unmatched returns "UTC" so the founder can see the fallback
 * in the queue monitor (the scheduling page surfaces the count of
 * rows that resolved to UTC).
 *
 * Kept deliberately small — only the cities Tristan's outreach
 * actually targets today. Adding rows is a one-line change; don't
 * pre-populate every tz under the sun.
 */

const HQ_PATTERNS: Array<[RegExp, string]> = [
  // Nordics
  [/helsinki|finland|finnish/i, "Europe/Helsinki"],
  [/stockholm|sweden|swedish/i, "Europe/Stockholm"],
  [/oslo|norway|norwegian/i, "Europe/Oslo"],
  [/copenhagen|denmark|danish/i, "Europe/Copenhagen"],
  [/reykjavik|iceland/i, "Atlantic/Reykjavik"],

  // Western / Central Europe
  [/amsterdam|noordwijk|rotterdam|hague|utrecht|netherlands|dutch/i, "Europe/Amsterdam"],
  [/london|uk|united kingdom|britain|england|scotland|wales/i, "Europe/London"],
  [/dublin|ireland|irish/i, "Europe/Dublin"],
  [/paris|france|french/i, "Europe/Paris"],
  [/berlin|munich|hamburg|frankfurt|germany|german/i, "Europe/Berlin"],
  [/zurich|geneva|bern|switzerland|swiss/i, "Europe/Zurich"],
  [/vienna|austria/i, "Europe/Vienna"],
  [/brussels|belgium/i, "Europe/Brussels"],
  [/madrid|barcelona|spain|spanish/i, "Europe/Madrid"],
  [/lisbon|porto|portugal|portuguese/i, "Europe/Lisbon"],
  [/rome|milan|italy|italian/i, "Europe/Rome"],
  [/luxembourg/i, "Europe/Luxembourg"],
  [/warsaw|poland|polish/i, "Europe/Warsaw"],

  // North America — Canada (explicit before US, since "Vancouver, BC" must beat "North America")
  [/toronto|ottawa|ontario/i, "America/Toronto"],
  [/vancouver|british columbia|\bbc\b/i, "America/Vancouver"],
  [/montreal|quebec/i, "America/Montreal"],
  [/calgary|edmonton|alberta/i, "America/Edmonton"],
  [/halifax|nova scotia/i, "America/Halifax"],

  // North America — US
  [/new york|\bnyc\b|manhattan|brooklyn/i, "America/New_York"],
  [/boston|massachusetts|cambridge/i, "America/New_York"],
  [/washington.?d\.?c|dc|virginia|maryland/i, "America/New_York"],
  [/miami|florida/i, "America/New_York"],
  [/atlanta|georgia/i, "America/New_York"],
  [/chicago|illinois/i, "America/Chicago"],
  [/austin|dallas|houston|texas/i, "America/Chicago"],
  [/denver|colorado/i, "America/Denver"],
  [/phoenix|arizona/i, "America/Phoenix"],
  [/seattle|washington state|portland|oregon/i, "America/Los_Angeles"],
  [/san francisco|menlo park|palo alto|\bsf\b|silicon valley|bay area|california|los angeles|\bla\b/i, "America/Los_Angeles"],

  // Asia / Pacific (sparse — add as Tristan's outreach expands)
  [/singapore/i, "Asia/Singapore"],
  [/hong kong/i, "Asia/Hong_Kong"],
  [/tokyo|japan/i, "Asia/Tokyo"],
  [/seoul|korea/i, "Asia/Seoul"],
  [/sydney|melbourne|australia/i, "Australia/Sydney"],

  // Middle East (Fischer Farms Middle East is a live prospect pipeline)
  [/dubai|abu dhabi|\buae\b|united arab emirates/i, "Asia/Dubai"],
  [/riyadh|saudi|\bksa\b/i, "Asia/Riyadh"],
  [/tel aviv|israel/i, "Asia/Jerusalem"],
];

/**
 * Map a free-text HQ location to an IANA timezone.
 *
 * Returns "UTC" for null, empty, or unmatched strings — the scheduling
 * page should surface the count of UTC-fallback rows so the founder
 * can decide whether to refine the patterns before dispatching.
 */
export function timezoneForLocation(hq: string | null | undefined): string {
  if (!hq) return "UTC";
  const trimmed = hq.trim();
  if (!trimmed) return "UTC";
  for (const [re, tz] of HQ_PATTERNS) {
    if (re.test(trimmed)) return tz;
  }
  return "UTC";
}

/**
 * Convert a local wall-clock time in a given IANA timezone to a UTC
 * Date. DST-correct: computes the offset at the target instant, not
 * the current date, so a schedule for 2026-10-26 06:30 Europe/London
 * resolves correctly across the autumn clock change.
 *
 * Approach: build an initial UTC guess, format it in the target zone,
 * compute the delta, and adjust. One iteration is accurate except on
 * the DST fall-back hour (where two wall-clock instants map to the
 * same local time) — we iterate twice to converge on the later of
 * the two, matching most civilian expectations ("07:00 London" on a
 * fall-back day resolves to the second 07:00).
 */
export function localToUtc(
  localYear: number,
  localMonth: number, // 1-12
  localDay: number, // 1-31
  localHour: number, // 0-23
  localMinute: number, // 0-59
  tz: string,
): Date {
  // Initial guess: treat the wall-clock components as if they were UTC.
  // This is always within 24 hours of the answer.
  let utcGuess = Date.UTC(
    localYear,
    localMonth - 1,
    localDay,
    localHour,
    localMinute,
    0,
    0,
  );

  // Iterate twice to converge across DST boundaries.
  for (let i = 0; i < 2; i++) {
    const parts = partsInZone(new Date(utcGuess), tz);
    const wallAsUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
      0,
    );
    const deltaMs = wallAsUtcMs - utcGuess;
    // If parts.wall == our target wall-clock, delta==0 and we're done.
    const targetWallMs = Date.UTC(
      localYear,
      localMonth - 1,
      localDay,
      localHour,
      localMinute,
      0,
      0,
    );
    const missingMs = targetWallMs - wallAsUtcMs;
    if (missingMs === 0) break;
    utcGuess += missingMs;
    // deltaMs unused once we adjust — kept as an intentional no-op; the
    // algorithm's correctness is in the "advance by missingMs then
    // re-check" loop above.
    void deltaMs;
  }

  return new Date(utcGuess);
}

function partsInZone(
  instant: Date,
  tz: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const bag: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    // Intl formats midnight as "24" in some locales; normalise.
    hour: Number(bag.hour) % 24,
    minute: Number(bag.minute),
  };
}
