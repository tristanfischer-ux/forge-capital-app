import { isDnc, isGenericInbox } from "@/lib/desk/identity";
import type { TrackerRow } from "@/lib/queries/tracker";

export type WaveFlag = "ok" | "amber" | "red";

export interface WaveScreen {
  id: string;
  partner_id: number | null;
  name: string;
  firm: string;
  email: string | null;
  status: string | null;
  flag: WaveFlag;
  reasons: string[];
}

export function screenWave(rows: TrackerRow[]): WaveScreen[] {
  return rows.map((r) => {
    const reasons: string[] = [];
    let flag: WaveFlag = "ok";
    const email = r.email ?? null;
    if (!r.partner_name || /general enquir/i.test(r.partner_name)) {
      reasons.push("no named person");
      flag = "red";
    }
    if (!email) {
      reasons.push("no email");
      flag = "red";
    } else if (isGenericInbox(email)) {
      reasons.push("generic inbox");
      flag = "red";
    }
    const dnc = isDnc(r.partner_name, r.firm_name);
    if (dnc) {
      reasons.push(dnc);
      flag = "red";
    }
    if (r.other_campaigns?.length) {
      reasons.push(`also on ${r.other_campaigns.filter(Boolean).slice(0, 3).join(", ")}`);
      if (flag === "ok") flag = "amber";
    }
    const days = r.days_since_last_contact;
    if (typeof days === "number" && days < 21 && (r.status_code === "+3" || r.status_code === "+5")) {
      reasons.push(`touched ${days}d ago`);
      if (flag === "ok") flag = "amber";
    }
    if (r.permission_status === "denied") {
      reasons.push("permission denied");
      flag = "red";
    }
    return {
      id: r.id,
      partner_id: r.partner_id,
      name: r.partner_name ?? "—",
      firm: r.firm_name ?? "—",
      email,
      status: r.status_code,
      flag,
      reasons,
    };
  });
}

export function principalPacket(opts: {
  raise: string;
  principalName?: string | null;
  rows: WaveScreen[];
}): { toHint: string; subject: string; body: string } {
  const greens = opts.rows.filter((r) => r.flag !== "red");
  const lines = greens
    .slice(0, 80)
    .map((r) => `${r.name} — ${r.firm}${r.email ? ` — ${r.email}` : ""}`)
    .join("\n");
  return {
    toHint: opts.principalName ?? "the principal",
    subject: `${opts.raise} — names for sign-off`,
    body: `Hello,\n\nI am putting together the next wave of investor outreach for ${opts.raise} and need your approval before I contact anyone.\n\nReply 1 = fine, 2 = be cautious, blank = leave it.\n\n${lines}\n\nBest regards,\nTristan Fischer\ntristan.fischer@gmail.com\n+44 7776191944\n`,
  };
}
