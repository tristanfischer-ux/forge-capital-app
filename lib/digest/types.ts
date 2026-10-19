import type { MandateHint } from "@/lib/digest/campaign-mandate";

export type WeeklyDigestStats = {
  sent: number;
  replies: number;
  repliesPositive: number;
  repliesNegative: number;
  repliesNeutral: number;
  meetings_booked: number;
  silent_over_7d: number;
  handovers: number;
  declines: number;
};

export type DigestCampaign = {
  id: string;
  name: string;
  display_name?: string | null;
  campaign_intent: string | null;
  counterpart_email: string | null;
};

export type DigestPartner = {
  id: string;
  status_code: string | null;
  last_contact_at: string | null;
  partner_name: string | null;
  partner_email: string | null;
  investor_id: number | null;
  firm_name: string | null;
  website: string | null;
};

export type DigestEvent = {
  id: string;
  campaign_partner_id: string;
  direction: string | null;
  event_type: string | null;
  event_at: string;
  summary: string | null;
  follow_up_due_at: string | null;
  follow_up_done_at: string | null;
  title: string | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
};

export type ForgeOsFirm = {
  id: string;
  canonical_name: string | null;
  website_domain: string | null;
  dnc: boolean | null;
  norm_name: string | null;
};

export type ForgeOsPerson = {
  id: string;
  firm_id: string | null;
  email: string | null;
  dnc: boolean | null;
};

export type ForgeOsAlias = {
  firm_id: string;
  alias: string | null;
  norm_alias: string | null;
};

export type ForgeOsParticipation = {
  firm_id: string | null;
  person_id: string | null;
  stage: string | null;
};

export type ForgeOsActivity = {
  id: string;
  occurred_at: string;
  channel: string | null;
  subject: string | null;
  source_id: string | null;
  mandate_ids: string[];
  firm_ids: string[];
};

export type DigestLoadedData = {
  campaign: DigestCampaign;
  partners: DigestPartner[];
  events: DigestEvent[];
  apexOutbound: DigestEvent[];
  mandate: MandateHint | null;
  otherMandates: MandateHint[];
  unmappedReason: string | null;
  allActiveCampaigns: { id: string; name: string; display_name?: string | null }[];
  firms: ForgeOsFirm[];
  people: ForgeOsPerson[];
  aliases: ForgeOsAlias[];
  participations: ForgeOsParticipation[];
  activities: ForgeOsActivity[];
};

export type DroppedEvent = {
  event_id: string;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  summary: string | null;
  reason: string;
  linked_mandate_codes: string[];
};

export type SuppressedFirm = {
  key: string;
  name: string;
  investor_ids: number[];
  reasons: string[];
};

export type MergedFirm = {
  key: string;
  name: string;
  investor_ids: number[];
  partner_ids: string[];
  forgeos_firm_ids: string[];
};

export type AttentionRowDebug = {
  name: string;
  status_code: string;
  forgeos_outbound_at: string | null;
  apex_outbound_at: string | null;
  printed: string;
  days: number | null;
};

export type DigestDebug = {
  campaign_id: string;
  campaign_name: string;
  mandate_code: string | null;
  mandate_id: string | null;
  unmapped_reason: string | null;
  counted_gmail_ids: string[];
  dropped_events: DroppedEvent[];
  suppressed_firms: SuppressedFirm[];
  merged_firms: MergedFirm[];
  attention: AttentionRowDebug[];
  silent: AttentionRowDebug[];
};

export type WeeklyDigestResult = {
  subject: string;
  body: string;
  stats: WeeklyDigestStats;
  debug: DigestDebug;
};
