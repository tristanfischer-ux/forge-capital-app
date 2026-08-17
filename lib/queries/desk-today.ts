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
  partner_id: number | null;
  partner_name: string | null;
  firm_name: string | null;
  campaign_name: string | null;
  status_code: string | null;
  last_contact_at: string | null;
  days: number;
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
  doubleAsks: DeskDoubleAsk[];
  approvals: DeskApproval[];
  blocks: { partner_id: number; partner_name: string | null; reason: string | null }[];
}

export async function getDeskToday(): Promise<DeskToday> {
  const supabase = await createServerClient();
  const now = Date.now();
  const weekOut = new Date(now + 7 * 86400000).toISOString();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();

  const [meetingsRes, repliesRes, cpRes, policyRes] = await Promise.all([
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
    supabase
      .from("campaign_partners")
      .select(
        `id, partner_id, status_code, permission_status, last_contact_at,
         partners_mirror:partner_id ( id, name, investors_mirror:investor_id ( firm_name ) ),
         campaigns:campaign_id ( name )`,
      )
      .limit(8000),
    supabase
      .from("contact_policy")
      .select("partner_id, reason, kind")
      .eq("kind", "block")
      .limit(200)
      .then((res) => {
        if (res.error) return { data: [] as { partner_id: number | null; reason: string | null; kind: string }[], error: null };
        return res;
      }),
  ]);

  if (meetingsRes.error) console.error("desk-today meetings", meetingsRes.error.message);
  if (repliesRes.error) console.error("desk-today replies", repliesRes.error.message);
  if (cpRes.error) console.error("desk-today campaign_partners", cpRes.error.message);
  console.error("desk-today cp_rows", (cpRes.data ?? []).length);

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
    campaigns: { name: string | null } | null;
  };

  const meetings: DeskMeeting[] = (meetingsRes.data ?? []).map((row) => {
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

  for (const raw of cpRes.data ?? []) {
    const row = raw as unknown as Nested & { id: string };
    const last = row.last_contact_at ? new Date(row.last_contact_at).getTime() : 0;
    const days = last ? Math.floor((now - last) / 86400000) : 999;
    const live = ["+0", "+3", "+5"].includes(row.status_code ?? "");
    if (live && days >= 7) {
      stuck.push({
        campaign_partner_id: row.id,
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

  stuck.sort((a, b) => b.days - a.days);

  const doubleAsks: DeskDoubleAsk[] = [];
  for (const [pid, v] of byPartner) {
    const liveRaises = v.raises.filter((r) => {
      const c = r.status_code ?? "";
      return c.startsWith("+") && c !== "+0" === false ? true : !["-1", "-2", "-3"].includes(c);
    });
    // two or more raises that are not dead
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

  return {
    meetings,
    replies,
    stuck: stuck.slice(0, 40),
    doubleAsks: doubleAsks.slice(0, 30),
    approvals: approvals.slice(0, 40),
    blocks: (policyRes.data ?? [])
      .filter((p) => p.partner_id)
      .map((p) => ({
        partner_id: p.partner_id as number,
        partner_name: blockNames.get(p.partner_id as number) ?? null,
        reason: (p.reason as string | null) ?? null,
      })),
  };
}
