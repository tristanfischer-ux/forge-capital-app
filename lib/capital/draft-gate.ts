import { collisionsFor, type CollisionRow } from "@/lib/capital/collision";
import type { MandateCode } from "@/lib/capital/mandates";
import { isGenericInbox } from "@/lib/capital/neverbounce";
import { lintDraft, warmOpenerLooksValid, type LintIssue } from "@/lib/capital/rulebook";
import { createCoreClient, createEngageClient } from "@/lib/supabase/capital";

const DRAFTABLE_STAGES = new Set([
  "approved",
  "approached",
  "responded",
  "meeting",
  "dataroom",
]);

export type WarmThread = {
  subject: string | null;
  occurred_at: string;
  channel: string;
};

export type DraftGate = {
  allowed: boolean;
  why: string;
  email_state: string | null;
  warm: boolean;
  lastThread: WarmThread | null;
  collisions: CollisionRow[];
  lint: LintIssue[];
  mandate_status: string | null;
  stage: string | null;
};

export async function lastThreadsForPeople(personIds: string[]): Promise<Map<string, WarmThread>> {
  const out = new Map<string, WarmThread>();
  if (!personIds.length) return out;
  const engage = createEngageClient();
  const { data: links } = await engage
    .from("activity_links")
    .select("activity_id, entity_id")
    .eq("entity_type", "person")
    .in("entity_id", personIds.slice(0, 200));
  const actIds = [...new Set((links ?? []).map((l) => l.activity_id))];
  if (!actIds.length) return out;
  const { data: acts } = await engage
    .from("activities")
    .select("id, occurred_at, channel, subject")
    .in("id", actIds)
    .in("channel", ["email_in", "email_out", "draft"])
    .order("occurred_at", { ascending: false });
  const peopleByAct = new Map<string, string[]>();
  for (const link of links ?? []) {
    const arr = peopleByAct.get(link.activity_id) ?? [];
    arr.push(link.entity_id);
    peopleByAct.set(link.activity_id, arr);
  }
  for (const a of acts ?? []) {
    for (const pid of peopleByAct.get(a.id) ?? []) {
      if (out.has(pid)) continue;
      out.set(pid, {
        subject: a.subject,
        occurred_at: a.occurred_at,
        channel: a.channel,
      });
    }
  }
  return out;
}

export async function lastThreadForPerson(personId: string | null): Promise<WarmThread | null> {
  if (!personId) return null;
  const map = await lastThreadsForPeople([personId]);
  return map.get(personId) ?? null;
}

export async function evaluateDraftGate(opts: {
  personId: string | null;
  firmId: string | null;
  mandateCode: MandateCode;
  stage: string | null;
  body?: string;
  subject?: string;
  opener?: string | null;
  lastThread?: WarmThread | null;
  collisions?: CollisionRow[];
  person?: {
    email?: string | null;
    email_state?: string | null;
    dnc?: boolean | null;
    dnc_reason?: string | null;
  } | null;
  firm?: {
    dnc?: boolean | null;
    dnc_reason?: string | null;
    hq_country?: string | null;
  } | null;
  mandateStatus?: string | null;
}): Promise<DraftGate> {
  let person = opts.person;
  let firm = opts.firm;
  let mandateStatus = opts.mandateStatus ?? null;
  if (person === undefined || firm === undefined || opts.mandateStatus === undefined) {
    const core = createCoreClient();
    const engage = createEngageClient();
    const [{ data: p }, { data: f }, { data: mandate }] = await Promise.all([
      opts.personId
        ? core
            .from("people")
            .select("id, full_name, email, email_state, dnc, dnc_reason")
            .eq("id", opts.personId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      opts.firmId
        ? core
            .from("firms")
            .select("id, canonical_name, dnc, dnc_reason, hq_country")
            .eq("id", opts.firmId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      engage
        .from("mandates")
        .select("code, status, narrative_notes")
        .eq("code", opts.mandateCode)
        .maybeSingle(),
    ]);
    if (person === undefined) person = p;
    if (firm === undefined) firm = f;
    if (opts.mandateStatus === undefined) mandateStatus = mandate?.status ?? null;
  }

  const lastThread =
    opts.lastThread !== undefined ? opts.lastThread : await lastThreadForPerson(opts.personId);
  const warm = Boolean(lastThread);
  const collisions =
    opts.collisions ?? (await collisionsFor(opts.firmId, opts.personId, opts.mandateCode));
  const openerPresent = warm
    ? warmOpenerLooksValid(opts.opener ?? opts.body ?? "", lastThread?.subject ?? null)
    : true;
  const lint = lintDraft({
    mandateCode: opts.mandateCode,
    mandateStatus,
    body: opts.body ?? "",
    subject: opts.subject,
    firmHqCountry: firm?.hq_country ?? null,
    warmRequired: warm && Boolean(opts.body || opts.opener),
    openerPresent,
  });

  let why = "ok";
  let allowed = true;
  if (firm?.dnc) {
    allowed = false;
    why = `firm DNC${firm.dnc_reason ? `: ${firm.dnc_reason}` : ""}`;
  } else if (person?.dnc) {
    allowed = false;
    why = `person DNC${person.dnc_reason ? `: ${person.dnc_reason}` : ""}`;
  } else if (!person) {
    allowed = false;
    why = "no named person";
  } else if (!person.email) {
    allowed = false;
    why = "no email";
  } else if (isGenericInbox(person.email) || person.email_state === "generic") {
    allowed = false;
    why = "generic inbox — Rule 13";
  } else if (person.email_state !== "verified") {
    allowed = false;
    why = `email ${person.email_state ?? "unknown"} — not verified`;
  } else if (mandateStatus === "paused") {
    allowed = false;
    why = "raise is paused";
  } else if (!DRAFTABLE_STAGES.has(opts.stage ?? "")) {
    allowed = false;
    why = `needs principal sign-off (stage ${opts.stage ?? "none"})`;
  } else if (collisions.length) {
    const c = collisions[0];
    const other = c.mandate_a === opts.mandateCode ? c.mandate_b : c.mandate_a;
    allowed = false;
    why = `also on ${other} ${c.days_apart} days ago`;
  } else if (warm && opts.body && !openerPresent) {
    allowed = false;
    why = "prior thread — opener must reference it";
  }
  const blocks = lint.filter((i) => i.severity === "block");
  if (allowed && blocks.length) {
    allowed = false;
    why = blocks[0].message;
  }

  return {
    allowed,
    why,
    email_state: person?.email_state ?? null,
    warm,
    lastThread,
    collisions,
    lint,
    mandate_status: mandateStatus,
    stage: opts.stage,
  };
}
