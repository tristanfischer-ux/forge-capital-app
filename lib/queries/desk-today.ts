import { skipRaiseName } from "@/lib/desk/status-map";
import {
  mergeMeetings,
  mergeReplies,
  readDeskWeekCache,
} from "@/lib/queries/desk-calendar";
import { createServerClient } from "@/lib/supabase/server";

export interface DeskMeeting {
  id: string;
  event_at: string;
  title: string | null;
  summary: string | null;
  partner_id: number | null;
  partner_name: string | null;
  firm_name: string | null;
  campaign_name: string | null;
  status_code: string | null;
  unmatched: boolean;
}

export interface DeskReply {
  id: string;
  event_at: string;
  summary: string | null;
  partner_id: number | null;
  partner_name: string | null;
  firm_name: string | null;
  campaign_name: string | null;
  status_code: string | null;
  gmail_thread_id: string | null;
}

export interface DeskStuck {
  campaign_partner_id: string;
  campaign_id: string | null;
  partner_id: number | null;
  partner_name: string | null;
  firm_name: string | null;
  campaign_name: string | null;
  status_code: string | null;
  last_contact_at: string | null;
  days: number | null;
}

export interface DeskStuckRaise {
  campaign_id: string | null;
  campaign_name: string | null;
  count: number;
  oldestDays: number | null;
  oldestName: string | null;
}

export interface DeskDoubleAsk {
  partner_id: number;
  partner_name: string | null;
  firm_name: string | null;
  raises: { campaign_name: string; status_code: string | null }[];
}

export interface DeskApproval {
  campaign_partner_id: string;
  partner_id: number | null;
  partner_name: string | null;
  firm_name: string | null;
  campaign_name: string | null;
  status_code: string | null;
  permission_status: string | null;
  blocked: boolean;
}

export interface DeskToday {
  meetings: DeskMeeting[];
  replies: DeskReply[];
  stuck: DeskStuck[];
  stuckByRaise: DeskStuckRaise[];
  stuckCount: number;
  doubleAsks: DeskDoubleAsk[];
  doubleAskCount: number;
  approvals: DeskApproval[];
  approvalCount: number;
  blocks: { partner_id: number; partner_name: string | null; reason: string | null }[];
}

const CP_SELECT = `id, partner_id, status_code, permission_status, last_contact_at,
         partners_mirror:partner_id ( id, name, investors_mirror:investor_id ( firm_name ) ),
         campaigns:campaign_id ( id, name )`;

async function fetchAllCampaignPartners(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
) {
  const pageSize = 1000;
  const rows: unknown[] = [];
  for (let from = 0; from < 20000; from += pageSize) {
    const { data, error } = await supabase
      .from("campaign_partners")
      .select(CP_SELECT)
      .range(from, from + pageSize - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

export async function getDeskToday(): Promise<DeskToday> {
  const supabase = await createServerClient();
  const now = Date.now();
  const weekOut = new Date(now + 7 * 86400000).toISOString();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();

  const [meetingsRes, repliesRes, cpRows, policyRes] = await Promise.all([
    supabase
      .from("contact_events")
      .select(
        `id, event_at, title, summary, channel,
         campaign_partners:campaign_partner_id (
           status_code, partner_id,
           partners_mirror:partner_id ( id, name, investors_mirror:investor_id ( firm_name ) ),
           campaigns:campaign_id ( name )
         )`,
      )
      .in("channel", ["meeting", "google_meet", "zoom", "teams", "in_person"])
      .gte("event_at", new Date(now - 86400000).toISOString())
      .lte("event_at", weekOut)
      .order("event_at", { ascending: true })
      .limit(40),
    supabase
      .from("contact_events")
      .select(
        `id, event_at, summary, gmail_thread_id,
         campaign_partners:campaign_partner_id (
           status_code, partner_id,
           partners_mirror:partner_id ( id, name, investors_mirror:investor_id ( firm_name ) ),
           campaigns:campaign_id ( name )
         )`,
      )
      .eq("direction", "inbound")
      .gte("event_at", weekAgo)
      .order("event_at", { ascending: false })
      .limit(40),
    fetchAllCampaignPartners(supabase),
    supabase
      .from("contact_policy")
      .select("partner_id, reason, kind")
      .eq("kind", "block")
      .limit(200)
      .then((res) => {
        if (res.error) {
          return { data: [] as { partner_id: number | null; reason: string | null; kind: string }[] };
        }
        return res;
      }),
  ]);

  const cpData = cpRows;

  type Nested = {
    status_code: string | null;
    partner_id: number | null;
    permission_status?: string | null;
    last_contact_at?: string | null;
    id?: string;
    partners_mirror: {
      id: number;
      name: string | null;
      investors_mirror: { firm_name: string | null } | null;
    } | null;
    campaigns: { id: string; name: string | null } | null;
  };

  const meetings: DeskMeeting[] = ((meetingsRes.data ?? []) as Record<string, unknown>[]).map((row) => {
    const cp = row.campaign_partners as unknown as Nested | null;
    return {
      id: row.id as string,
      event_at: row.event_at as string,
      title: (row as { title?: string | null }).title ?? null,
      summary: row.summary as string | null,
      partner_id: cp?.partner_id ?? cp?.partners_mirror?.id ?? null,
      partner_name: cp?.partners_mirror?.name ?? null,
      firm_name: cp?.partners_mirror?.investors_mirror?.firm_name ?? null,
      campaign_name: cp?.campaigns?.name ?? null,
      status_code: cp?.status_code ?? null,
      unmatched: !cp?.partners_mirror,
    };
  });

  const replies: DeskReply[] = (repliesRes.data ?? []).map((row) => {
    const cp = row.campaign_partners as unknown as Nested | null;
    return {
      id: row.id as string,
      event_at: row.event_at as string,
      summary: row.summary as string | null,
      partner_id: cp?.partner_id ?? cp?.partners_mirror?.id ?? null,
      partner_name: cp?.partners_mirror?.name ?? null,
      firm_name: cp?.partners_mirror?.investors_mirror?.firm_name ?? null,
      campaign_name: cp?.campaigns?.name ?? null,
      status_code: cp?.status_code ?? null,
      gmail_thread_id: row.gmail_thread_id as string | null,
    };
  });

  const stuck: DeskStuck[] = [];
  const byPartner = new Map<number, { name: string | null; firm: string | null; raises: { campaign_name: string; status_code: string | null }[] }>();
  const approvals: DeskApproval[] = [];
  const blockedIds = new Set(
    (policyRes.data ?? [])
      .map((p) => p.partner_id as number | null)
      .filter((x): x is number => x != null),
  );

  for (const raw of cpData) {
    const row = raw as unknown as Nested & { id: string };
    if (skipRaiseName(row.campaigns?.name ?? null)) continue;
    const lastMs = row.last_contact_at ? new Date(row.last_contact_at).getTime() : 0;
    const days = lastMs ? Math.floor((now - lastMs) / 86400000) : null;
    const code = row.status_code ?? "";
    const sentAndClockBroken = (code === "+3" || code === "+5") && days == null;
    const clockExpired =
      days != null && days >= 7 && (code === "+0" || code === "+3" || code === "+5");
    if (sentAndClockBroken || clockExpired) {
      stuck.push({
        campaign_partner_id: row.id,
        campaign_id: row.campaigns?.id ?? null,
        partner_id: row.partner_id,
        partner_name: row.partners_mirror?.name ?? null,
        firm_name: row.partners_mirror?.investors_mirror?.firm_name ?? null,
        campaign_name: row.campaigns?.name ?? null,
        status_code: row.status_code,
        last_contact_at: row.last_contact_at ?? null,
        days,
      });
    }
    if (row.partner_id) {
      const cur = byPartner.get(row.partner_id) ?? {
        name: row.partners_mirror?.name ?? null,
        firm: row.partners_mirror?.investors_mirror?.firm_name ?? null,
        raises: [],
      };
      cur.raises.push({
        campaign_name: row.campaigns?.name ?? "—",
        status_code: row.status_code,
      });
      byPartner.set(row.partner_id, cur);
    }
    if (row.status_code === "+1" || row.status_code === "+2") {
      approvals.push({
        campaign_partner_id: row.id,
        partner_id: row.partner_id,
        partner_name: row.partners_mirror?.name ?? null,
        firm_name: row.partners_mirror?.investors_mirror?.firm_name ?? null,
        campaign_name: row.campaigns?.name ?? null,
        status_code: row.status_code,
        permission_status: row.permission_status ?? "not_required",
        blocked: row.partner_id != null && blockedIds.has(row.partner_id),
      });
    }
  }

  stuck.sort((a, b) => (b.days ?? 10_000) - (a.days ?? 10_000));

  const stuckByRaiseMap = new Map<string, DeskStuckRaise>();
  for (const s of stuck) {
    const key = s.campaign_id ?? s.campaign_name ?? "—";
    const cur = stuckByRaiseMap.get(key) ?? {
      campaign_id: s.campaign_id,
      campaign_name: s.campaign_name,
      count: 0,
      oldestDays: null,
      oldestName: null,
    };
    cur.count += 1;
    if (s.days != null && (cur.oldestDays == null || s.days > cur.oldestDays)) {
      cur.oldestDays = s.days;
      cur.oldestName = s.partner_name ?? s.firm_name;
    } else if (cur.oldestName == null) {
      cur.oldestName = s.partner_name ?? s.firm_name;
    }
    stuckByRaiseMap.set(key, cur);
  }
  const stuckByRaise = [...stuckByRaiseMap.values()].sort((a, b) => b.count - a.count);

  const doubleAsks: DeskDoubleAsk[] = [];
  for (const [pid, v] of byPartner) {
    const open = v.raises.filter((r) => !["-1", "-2", "-3"].includes(r.status_code ?? ""));
    if (open.length >= 2) {
      doubleAsks.push({
        partner_id: pid,
        partner_name: v.name,
        firm_name: v.firm,
        raises: v.raises,
      });
    }
  }

  const blockNames = new Map<number, string | null>();
  for (const [pid, v] of byPartner) blockNames.set(pid, v.name);

  const cache = await readDeskWeekCache();

  return {
    meetings: mergeMeetings(meetings, cache.meetings),
    replies: mergeReplies(replies, cache.replies),
    stuck: stuck.slice(0, 40),
    stuckByRaise,
    stuckCount: stuck.length,
    doubleAsks: doubleAsks.slice(0, 30),
    doubleAskCount: doubleAsks.length,
    approvals: approvals.slice(0, 40),
    approvalCount: approvals.length,
    blocks: (policyRes.data ?? [])
      .filter((p) => p.partner_id)
      .map((p) => ({
        partner_id: p.partner_id as number,
        partner_name: blockNames.get(p.partner_id as number) ?? null,
        reason: (p.reason as string | null) ?? null,
      })),
  };
}
