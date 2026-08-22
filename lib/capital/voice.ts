import {
  CALENDLY_URL,
  MANDATE_LABEL,
  isCustomerMandate,
  TRISTAN_EMAIL,
  TRISTAN_LINKEDIN,
  TRISTAN_MOBILE,
  TRISTAN_THOUGHTS,
  type MandateCode,
} from "@/lib/capital/mandates";

export function firstName(fullName: string | null | undefined): string {
  const n = (fullName ?? "").trim();
  if (!n) return "";
  return n.split(/\s+/)[0] ?? "";
}

export function composeOutreachDraft(opts: {
  personName: string;
  firmName: string;
  mandateCode: MandateCode;
  askSummary?: string | null;
  narrativeNotes?: string | null;
  thesisLine?: string | null;
  warm: boolean;
  lastSubject?: string | null;
  lastOccurredAt?: string | null;
  opener?: string | null;
}): { subject: string; body: string } {
  const first = firstName(opts.personName) || opts.personName;
  const company = MANDATE_LABEL[opts.mandateCode];
  if (isCustomerMandate(opts.mandateCode)) {
    return composeYuriOutreach(opts, first);
  }
  const ask = (opts.askSummary ?? "").trim();
  const subject = opts.warm
    ? `${company} — following up`
    : `${company}`;

  const signOff = [
    "Best regards,",
    "Tristan Fischer",
    TRISTAN_EMAIL,
    TRISTAN_MOBILE,
    TRISTAN_LINKEDIN,
    `Thought pieces: ${TRISTAN_THOUGHTS}`,
  ].join("\n");

  const pitch = ask
    ? `I have been asked to help ${company} with its raise (${ask}).`
    : `I have been asked to help ${company} with its raise.`;

  const thesis =
    (opts.thesisLine ?? "").trim() ||
    `My understanding is that ${opts.firmName} looks at businesses of this kind. If that is right, I would like to explain why ${company} may fit.`;

  const askLine = `Would you have 20 minutes in the next few days?\n${CALENDLY_URL}`;

  let opener: string;
  if (opts.warm) {
    const custom = (opts.opener ?? "").trim();
    if (custom) {
      opener = custom;
    } else {
      const when = opts.lastOccurredAt ? opts.lastOccurredAt.slice(0, 10) : "our last exchange";
      const about = opts.lastSubject ? ` about ${opts.lastSubject}` : "";
      opener = `Good to be back in touch after ${when}${about}.`;
    }
  } else {
    opener = `My name is Tristan Fischer. For the past twenty-five years I have designed, financed and built capital-intensive industrial technology businesses. I have worked in Citigroup Project Finance, Shell Technology Ventures, Lumicity, C-Capture, Fischer Farms, Camco (AIM-listed), and have raised around £200 million.`;
  }

  const body = [
    `Dear ${first},`,
    "",
    opener,
    "",
    pitch,
    "",
    thesis,
    "",
    askLine,
    "",
    signOff,
    "",
  ].join("\n");

  return { subject, body };
}

function signOffBlock(kind: "raise" | "yuri" = "raise"): string {
  if (kind === "yuri") {
    return [
      "Best wishes,",
      "Tristan",
      "",
      "Tristan Fischer · Strategic Advisor, Yuri",
      TRISTAN_EMAIL,
      TRISTAN_MOBILE,
      TRISTAN_LINKEDIN,
    ].join("\n");
  }
  return [
    "Best regards,",
    "Tristan Fischer",
    TRISTAN_EMAIL,
    TRISTAN_MOBILE,
    TRISTAN_LINKEDIN,
    `Thought pieces: ${TRISTAN_THOUGHTS}`,
  ].join("\n");
}

type OutreachOpts = Parameters<typeof composeOutreachDraft>[0];

/** Proven RPM VoC template. Never a raise pitch. */
function composeYuriOutreach(opts: OutreachOpts, first: string): { subject: string; body: string } {
  const lab = (opts.firmName || "your lab").trim();
  const custom = (opts.opener ?? "").trim();
  let opener: string;
  if (opts.warm) {
    opener =
      custom ||
      `Good to be back in touch after ${opts.lastOccurredAt ? opts.lastOccurredAt.slice(0, 10) : "our last exchange"}${
        opts.lastSubject ? ` about ${opts.lastSubject.replace(/^re:\s*/i, "")}` : ""
      }.`;
  } else {
    opener =
      custom ||
      `I'm Tristan Fischer, strategic advisor to the Yuri team, who supplied the RPM (Random Positioning Machine) ${lab} uses.`;
  }
  const subject = opts.warm
    ? `Re: ${opts.lastSubject?.replace(/^re:\s*/i, "") || "Yuri & the RPM"}`
    : "Yuri & the RPM — a short call?";
  const body = [
    `Dear ${first},`,
    "",
    opener,
    "",
    "I'm speaking with RPM groups to understand how they use the machine and where the science, and the hardware, could go next. Might we find 30 minutes for a call? I'll happily work around you.",
    "",
    `My calendar's here if it's easy to grab a slot: ${CALENDLY_URL} — or suggest a time and I'll send an invite.`,
    "",
    "I've copied Maria, Christian and Daniel at Yuri.",
    "",
    signOffBlock("yuri"),
    "",
  ].join("\n");
  return { subject, body };
}

/** Short, polite chase of an earlier email. Never a second cold bio. */
export function composeChaserDraft(opts: {
  personName: string;
  firmName: string;
  mandateCode: MandateCode;
  lastSubject?: string | null;
  lastOccurredAt?: string | null;
}): { subject: string; body: string } {
  const first = firstName(opts.personName) || opts.personName;
  const company = MANDATE_LABEL[opts.mandateCode];
  if (isCustomerMandate(opts.mandateCode)) {
    const when = opts.lastOccurredAt
      ? new Date(opts.lastOccurredAt).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
        })
      : "recently";
    const subject = `Re: ${opts.lastSubject?.replace(/^re:\s*/i, "") || "Yuri & the RPM"}`;
    const body = [
      `Dear ${first},`,
      "",
      `I wrote on ${when} about Yuri's RPM. I know inboxes are busy — I wanted to reconnect briefly.`,
      "",
      "Might we still find 30 minutes for a call? I'll happily work around you.",
      CALENDLY_URL,
      "",
      "I've copied Maria, Christian and Daniel at Yuri.",
      "",
      signOffBlock("yuri"),
      "",
    ].join("\n");
    return { subject, body };
  }
  const when = opts.lastOccurredAt
    ? new Date(opts.lastOccurredAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
      })
    : "recently";
  const about = opts.lastSubject
    ? `about ${opts.lastSubject.replace(/^re:\s*/i, "")}`
    : `about ${company}`;
  const subject = `Re: ${opts.lastSubject?.replace(/^re:\s*/i, "") || company}`;
  const body = [
    `Dear ${first},`,
    "",
    `I wrote on ${when} ${about}. I know inboxes are busy — I wanted to reconnect briefly.`,
    "",
    `Would you have 20 minutes in the next few days?`,
    CALENDLY_URL,
    "",
    signOffBlock(),
    "",
  ].join("\n");
  return { subject, body };
}

export function composeThankYouDraft(opts: {
  personName: string;
  firmName: string;
  mandateCodes: MandateCode[];
  callSummary?: string | null;
}): { subject: string; body: string } {
  const first = firstName(opts.personName) || opts.personName;
  if (opts.mandateCodes.includes("YU")) {
    const recap = (opts.callSummary ?? "").trim().slice(0, 400);
    const body = [
      `Dear ${first},`,
      "",
      "Thank you for the time today — that was a useful conversation on the RPM.",
      recap ? `\n${recap}\n` : "",
      "I've copied Maria, Christian and Daniel at Yuri.",
      "",
      signOffBlock("yuri"),
      "",
    ].join("\n");
    return { subject: "Thank you — Yuri & the RPM", body };
  }
  const raises = opts.mandateCodes.map((c) => MANDATE_LABEL[c]).join(" and ");
  const subject = `Thank you — ${opts.firmName}`;
  const recap = (opts.callSummary ?? "").trim().slice(0, 400);
  const body = [
    `Dear ${first},`,
    "",
    `Thank you for the time today${raises ? ` — useful on ${raises}` : ""}.`,
    recap ? `\n${recap}\n` : "",
    `Happy to continue whenever it is convenient.`,
    CALENDLY_URL,
    "",
    signOffBlock(),
    "",
  ].join("\n");
  return { subject, body };
}

export function composeCallFollowUpDraft(opts: {
  personName: string;
  firmName: string;
  mandateCode: MandateCode;
  nextStep?: string | null;
}): { subject: string; body: string } {
  const first = firstName(opts.personName) || opts.personName;
  const company = MANDATE_LABEL[opts.mandateCode];
  if (isCustomerMandate(opts.mandateCode)) {
    const step = (opts.nextStep ?? "").trim();
    const body = [
      `Dear ${first},`,
      "",
      "Thank you again for today. As discussed on the RPM:",
      step ? `\n${step}\n` : "",
      "Happy to pick this up whenever it is convenient.",
      CALENDLY_URL,
      "",
      "I've copied Maria, Christian and Daniel at Yuri.",
      "",
      signOffBlock("yuri"),
      "",
    ].join("\n");
    return { subject: "Yuri & the RPM — following our call", body };
  }
  const step = (opts.nextStep ?? "").trim();
  const subject = `${company} — following our call`;
  const body = [
    `Dear ${first},`,
    "",
    `Thank you again for today. As discussed on ${company}:`,
    step ? `\n${step}\n` : "",
    `Would you have 20 minutes to pick this up?`,
    CALENDLY_URL,
    "",
    signOffBlock(),
    "",
  ].join("\n");
  return { subject, body };
}
