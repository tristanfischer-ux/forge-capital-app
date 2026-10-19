import {
  extraSubjectHints,
  resolveCampaignMandate,
  type MandateHint,
} from "@/lib/digest/campaign-mandate";
import { gmailSourceKeys, MS_PER_DAY } from "@/lib/digest/names";
import type {
  DigestCampaign,
  DigestEvent,
  DigestLoadedData,
  DigestPartner,
  ForgeOsActivity,
  ForgeOsAlias,
  ForgeOsFirm,
  ForgeOsParticipation,
  ForgeOsPerson,
} from "@/lib/digest/types";
import {
  capitalConfigured,
  createCoreClient,
  createEngageClient,
} from "@/lib/supabase/capital";

function unwrap<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function pageRange<T>(
  run: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await run(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function inChunks<T, I>(
  ids: I[],
  size: number,
  load: (chunk: I[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    if (!chunk.length) continue;
    out.push(...(await load(chunk)));
  }
  return out;
}

type PartnerJoin = {
  id: string;
  status_code: string | null;
  last_contact_at: string | null;
  partner_id: number | null;
  partners_mirror:
    | {
        name?: string | null;
        email?: string | null;
        investor_id?: number | null;
        investors_mirror?:
          | { id?: number | null; firm_name?: string | null; website?: string | null }
          | { id?: number | null; firm_name?: string | null; website?: string | null }[]
          | null;
      }
    | {
        name?: string | null;
        email?: string | null;
        investor_id?: number | null;
        investors_mirror?:
          | { id?: number | null; firm_name?: string | null; website?: string | null }
          | { id?: number | null; firm_name?: string | null; website?: string | null }[]
          | null;
      }[]
    | null;
};

function flattenPartner(row: PartnerJoin): DigestPartner {
  const pm = unwrap(row.partners_mirror);
  const inv = unwrap(pm?.investors_mirror ?? null);
  const investorId = inv?.id ?? pm?.investor_id ?? null;
  return {
    id: row.id,
    status_code: row.status_code,
    last_contact_at: row.last_contact_at,
    partner_name: pm?.name ?? null,
    partner_email: pm?.email ?? null,
    investor_id: investorId == null ? null : Number(investorId),
    firm_name: inv?.firm_name ?? null,
    website: inv?.website ?? null,
  };
}

function asEvent(row: Record<string, unknown>): DigestEvent {
  return {
    id: String(row.id),
    campaign_partner_id: String(row.campaign_partner_id),
    direction: (row.direction as string | null) ?? null,
    event_type: (row.event_type as string | null) ?? null,
    event_at: String(row.event_at),
    summary: (row.summary as string | null) ?? null,
    follow_up_due_at: (row.follow_up_due_at as string | null) ?? null,
    follow_up_done_at: (row.follow_up_done_at as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    gmail_message_id: (row.gmail_message_id as string | null) ?? null,
    gmail_thread_id: (row.gmail_thread_id as string | null) ?? null,
  };
}

const EVENT_SELECT =
  "id, campaign_partner_id, direction, event_type, event_at, summary, follow_up_due_at, follow_up_done_at, title, gmail_message_id, gmail_thread_id";

export async function loadWeeklyDigest(opts: {
  campaignId: string;
  now: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apex: any;
}): Promise<{ ok: true; data: DigestLoadedData } | { ok: false; error: string }> {
  const { campaignId, now, apex } = opts;
  try {
    const { data: campaignRow, error: campaignErr } = await apex
      .from("campaigns")
      .select(
        "id, name, display_name, campaign_intent, counterpart_email, status",
      )
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignErr) return { ok: false, error: `campaign fetch failed: ${campaignErr.message}` };
    if (!campaignRow) return { ok: false, error: "campaign not found" };
    const campaign: DigestCampaign = {
      id: campaignRow.id,
      name: campaignRow.name,
      display_name: campaignRow.display_name ?? null,
      campaign_intent: campaignRow.campaign_intent ?? null,
      counterpart_email: campaignRow.counterpart_email ?? null,
    };

    const partnerRows = await pageRange<PartnerJoin>((from, to) =>
      apex
        .from("campaign_partners")
        .select(
          `id, campaign_id, status_code, last_contact_at, partner_id,
           partners_mirror:partner_id (
             name, email, investor_id,
             investors_mirror:investor_id ( id, firm_name, website )
           )`,
        )
        .eq("campaign_id", campaignId)
        .range(from, to),
    );
    const partners = partnerRows.map(flattenPartner);
    const partnerIds = partners.map((p) => p.id);

    const fourteenAgo = new Date(now.getTime() - 14 * MS_PER_DAY).toISOString();
    const upcomingEnd = new Date(now.getTime() + 7 * MS_PER_DAY).toISOString();
    const nowIso = now.toISOString();

    const recent: DigestEvent[] = partnerIds.length
      ? await inChunks(partnerIds, 80, async (chunk) => {
          const { data, error } = await apex
            .from("contact_events")
            .select(EVENT_SELECT)
            .in("campaign_partner_id", chunk)
            .gte("event_at", fourteenAgo)
            .order("event_at", { ascending: false });
          if (error) throw new Error(`events fetch failed: ${error.message}`);
          return (data ?? []).map((r: Record<string, unknown>) => asEvent(r));
        })
      : [];

    const due: DigestEvent[] = partnerIds.length
      ? await inChunks(partnerIds, 80, async (chunk) => {
          const { data, error } = await apex
            .from("contact_events")
            .select(EVENT_SELECT)
            .in("campaign_partner_id", chunk)
            .gte("follow_up_due_at", nowIso)
            .lte("follow_up_due_at", upcomingEnd)
            .is("follow_up_done_at", null);
          if (error) throw new Error(`follow-up fetch failed: ${error.message}`);
          return (data ?? []).map((r: Record<string, unknown>) => asEvent(r));
        })
      : [];

    const eventsById = new Map<string, DigestEvent>();
    for (const e of [...recent, ...due]) eventsById.set(e.id, e);

    const apexOutbound: DigestEvent[] = partnerIds.length
      ? await inChunks(partnerIds, 80, async (chunk) => {
          const rows = await pageRange<Record<string, unknown>>((from, to) =>
            apex
              .from("contact_events")
              .select(EVENT_SELECT)
              .in("campaign_partner_id", chunk)
              .eq("direction", "outbound")
              .order("event_at", { ascending: false })
              .range(from, to),
          );
          return rows.map((r) => asEvent(r));
        })
      : [];
    for (const e of apexOutbound) eventsById.set(e.id, e);
    const events = [...eventsById.values()];

    const { data: campaignRows, error: allCampErr } = await apex
      .from("campaigns")
      .select("id, name, display_name, status")
      .eq("status", "active");
    if (allCampErr) {
      return { ok: false, error: `campaigns list failed: ${allCampErr.message}` };
    }
    const allActiveCampaigns = (campaignRows ?? []).map(
      (c: { id: string; name: string; display_name?: string | null }) => ({
        id: c.id,
        name: c.name,
        display_name: c.display_name ?? null,
      }),
    );

    let mandate: MandateHint | null = null;
    let otherMandates: MandateHint[] = [];
    let unmappedReason: string | null = "ForgeOS is not configured";
    let firms: ForgeOsFirm[] = [];
    let people: ForgeOsPerson[] = [];
    let aliases: ForgeOsAlias[] = [];
    let participations: ForgeOsParticipation[] = [];
    let activities: ForgeOsActivity[] = [];

    if (capitalConfigured()) {
      const core = createCoreClient();
      const engage = createEngageClient();
      const mandateRows = await pageRange<{
        id: string;
        code: string;
        company_name: string | null;
      }>((from, to) =>
        engage.from("mandates").select("id, code, company_name").range(from, to),
      );
      const resolved = resolveCampaignMandate(campaign, mandateRows);
      mandate = resolved.mandate;
      unmappedReason = resolved.unmappedReason;
      otherMandates = mandateRows
        .filter((m) => !mandate || m.id !== mandate.id)
        .map((m) => ({
          id: m.id,
          code: m.code,
          company_name: m.company_name,
          hints: [
            ...extraSubjectHints(m.code),
            m.company_name ?? "",
          ].filter(Boolean),
        }));

      firms = await pageRange<ForgeOsFirm>((from, to) =>
        core
          .from("firms")
          .select("id, canonical_name, website_domain, dnc, norm_name")
          .range(from, to),
      );
      aliases = await pageRange<ForgeOsAlias>((from, to) =>
        core.from("firm_aliases").select("firm_id, alias, norm_alias").range(from, to),
      );
      people = await pageRange<ForgeOsPerson>((from, to) =>
        core.from("people").select("id, firm_id, email, dnc").range(from, to),
      );

      if (mandate) {
        participations = await pageRange<ForgeOsParticipation>((from, to) =>
          engage
            .from("participations")
            .select("firm_id, person_id, stage")
            .eq("mandate_id", mandate!.id)
            .range(from, to),
        );
      }

      const activityById = new Map<string, ForgeOsActivity>();
      const ensureActivity = (row: {
        id: string;
        occurred_at: string;
        channel: string | null;
        subject: string | null;
        source_id: string | null;
      }) => {
        const existing = activityById.get(row.id);
        if (existing) return existing;
        const created: ForgeOsActivity = {
          id: row.id,
          occurred_at: row.occurred_at,
          channel: row.channel,
          subject: row.subject,
          source_id: row.source_id,
          mandate_ids: [],
          firm_ids: [],
        };
        activityById.set(row.id, created);
        return created;
      };

      if (mandate) {
        const mandateLinks = await pageRange<{ activity_id: string }>((from, to) =>
          engage
            .from("activity_links")
            .select("activity_id")
            .eq("entity_type", "mandate")
            .eq("entity_id", mandate!.id)
            .range(from, to),
        );
        const mandateActIds = [...new Set(mandateLinks.map((l) => l.activity_id))];
        if (mandateActIds.length) {
          const rows = await inChunks(mandateActIds, 80, async (chunk) => {
            const { data, error } = await engage
              .from("activities")
              .select("id, occurred_at, channel, subject, source_id")
              .in("id", chunk);
            if (error) throw new Error(`activities: ${error.message}`);
            return data ?? [];
          });
          for (const row of rows) ensureActivity(row);
        }
      }

      const gmailKeys = new Set<string>();
      for (const e of [...events, ...apexOutbound]) {
        for (const k of gmailSourceKeys(e.gmail_message_id)) gmailKeys.add(k);
        for (const k of gmailSourceKeys(e.gmail_thread_id)) gmailKeys.add(k);
      }
      const gmailList = [...gmailKeys];
      if (gmailList.length) {
        const found = await inChunks(gmailList, 80, async (chunk) => {
          const { data, error } = await engage
            .from("activities")
            .select("id, occurred_at, channel, subject, source_id")
            .in("source_id", chunk);
          if (error) throw new Error(`activities by source: ${error.message}`);
          return data ?? [];
        });
        for (const row of found) ensureActivity(row);
      }

      const allActIds = [...activityById.keys()];
      if (allActIds.length) {
        const links = await inChunks(
          allActIds,
          80,
          async (chunk) => {
            const { data, error } = await engage
              .from("activity_links")
              .select("activity_id, entity_type, entity_id")
              .in("activity_id", chunk)
              .in("entity_type", ["mandate", "firm"]);
            if (error) throw new Error(`activity_links: ${error.message}`);
            return data ?? [];
          },
        );
        for (const link of links) {
          const act = activityById.get(link.activity_id);
          if (!act) continue;
          if (link.entity_type === "mandate" && !act.mandate_ids.includes(link.entity_id)) {
            act.mandate_ids.push(link.entity_id);
          }
          if (link.entity_type === "firm" && !act.firm_ids.includes(link.entity_id)) {
            act.firm_ids.push(link.entity_id);
          }
        }
      }
      activities = [...activityById.values()];
    }

    return {
      ok: true,
      data: {
        campaign,
        partners,
        events,
        apexOutbound,
        mandate,
        otherMandates,
        unmappedReason,
        allActiveCampaigns,
        firms,
        people,
        aliases,
        participations,
        activities,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function listCampaignMandateMappings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apex: any,
): Promise<{
  mapped: { campaign_id: string; name: string; code: string; mandate_id: string }[];
  unmapped: { campaign_id: string; name: string; reason: string }[];
}> {
  const { data: campaigns, error } = await apex
    .from("campaigns")
    .select("id, name, display_name, status")
    .eq("status", "active");
  if (error) throw new Error(error.message);
  const mapped: { campaign_id: string; name: string; code: string; mandate_id: string }[] = [];
  const unmapped: { campaign_id: string; name: string; reason: string }[] = [];
  if (!capitalConfigured()) {
    for (const c of campaigns ?? []) {
      unmapped.push({
        campaign_id: c.id,
        name: c.name,
        reason: "ForgeOS is not configured",
      });
    }
    return { mapped, unmapped };
  }
  const engage = createEngageClient();
  const mandates = await pageRange<{
    id: string;
    code: string;
    company_name: string | null;
  }>((from, to) =>
    engage.from("mandates").select("id, code, company_name").range(from, to),
  );
  for (const c of campaigns ?? []) {
    const resolved = resolveCampaignMandate(c, mandates);
    if (resolved.mandate) {
      mapped.push({
        campaign_id: c.id,
        name: c.name,
        code: resolved.mandate.code,
        mandate_id: resolved.mandate.id,
      });
    } else {
      unmapped.push({
        campaign_id: c.id,
        name: c.name,
        reason: resolved.unmappedReason ?? "unmapped",
      });
    }
  }
  return { mapped, unmapped };
}
