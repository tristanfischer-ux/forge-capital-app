import {
  CALENDLY_URL,
  MANDATE_LABEL,
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

function signOffBlock(): string {
  return [
    "Best regards,",
    "Tristan Fischer",
    TRISTAN_EMAIL,
    TRISTAN_MOBILE,
    TRISTAN_LINKEDIN,
    `Thought pieces: ${TRISTAN_THOUGHTS}`,
  ].join("\n");
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
