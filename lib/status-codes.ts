/**
 * The 17-code status taxonomy from Outreach-Writing-Rules-TF.md Rule 8
 * (and the xlsx Legend sheet, which is byte-identical across MASTER,
 * STEPHAN, ANDREW). Single source of truth for dropdowns and colour-
 * family classification. Do NOT extend without updating the outreach
 * writing rules doc first — the taxonomy is deliberate.
 *
 * +6.5 Handover to company is a multi-party-only state — on self-managed
 * campaigns (counterpart_email = null) the tracker drawer hides it via
 * statusCodesVisibleFor() in lib/queries/self-managed.ts. The Opus reply
 * classifier in /approval/test-replies also reroutes `handover` sentiment
 * to `positive` on self-managed campaigns so +6.5 is never written there.
 */
export interface StatusCodeDef {
  code: string;
  label: string;
  /** Visual family the StatusBadge colours from. */
  family: "committed" | "progressing" | "pending" | "dead";
}

export const STATUS_CODES: readonly StatusCodeDef[] = [
  { code: "+12", label: "Committed",                family: "committed" },
  { code: "+11", label: "Term sheet",               family: "committed" },
  { code: "+10", label: "NDA / diligence",          family: "committed" },
  { code: "+9",  label: "Meeting held",             family: "progressing" },
  { code: "+8",  label: "Meeting scheduled",        family: "progressing" },
  { code: "+7",  label: "Meeting offered",          family: "progressing" },
  { code: "+6.5", label: "Handover to company",     family: "progressing" },
  { code: "+6",  label: "Response received",        family: "progressing" },
  { code: "+5",  label: "Follow-up sent",           family: "progressing" },
  { code: "+4",  label: "Auto-reply / OOO",         family: "progressing" },
  { code: "+3",  label: "Email sent",               family: "progressing" },
  { code: "+2",  label: "Drafted — ready to send",  family: "pending" },
  { code: "+1",  label: "Approved — awaiting draft", family: "pending" },
  { code: "+0",  label: "Pending approval",         family: "pending" },
  { code: "-1",  label: "Declined",                 family: "dead" },
  { code: "-2",  label: "Bounced",                  family: "dead" },
  { code: "-3",  label: "Disqualified",             family: "dead" },
] as const;

export const STATUS_BY_CODE: Record<string, StatusCodeDef> = Object.fromEntries(
  STATUS_CODES.map((s) => [s.code, s]),
);

export function labelFor(code: string | null): string | null {
  if (!code) return null;
  return STATUS_BY_CODE[code]?.label ?? null;
}
