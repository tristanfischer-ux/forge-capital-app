export type OutreachDraftRow = {
  personId: string;
  firmId: string | null;
  participationId: string;
  personName: string;
  firmName: string;
  email: string | null;
  emailState: string | null;
  stage: string;
  sample: boolean;
  why: string;
  thesisLine: string | null;
  thesisSource: string | null;
  subject: string | null;
  body: string | null;
  needsResearch: boolean;
  gateWhy: string | null;
  collision: boolean;
};

export const OUTREACH_RAISES = ["SS", "OD", "FF", "PA", "CA", "US"] as const;
