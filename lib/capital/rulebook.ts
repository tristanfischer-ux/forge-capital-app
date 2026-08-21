import type { MandateCode } from "@/lib/capital/mandates";
import { CALENDLY_URL, TRISTAN_MOBILE } from "@/lib/capital/mandates";

export type LintIssue = { severity: "block" | "flag"; message: string };

const PRIME = /\bprimes?\b/i;
const NASDAQ = /\bnasdaq\b/i;
const WRONG_MOBILE = /\+44\s*7771\s*913\s*882/;
const PHOTO_HINT = /data:image|image\/(jpeg|png|gif)|photo of the launch|launch-from-ship/i;

export function lintDraft(opts: {
  mandateCode: MandateCode;
  mandateStatus?: string | null;
  body: string;
  subject?: string;
  firmHqCountry?: string | null;
  warmRequired: boolean;
  openerPresent: boolean;
  hasAttachment?: boolean;
}): LintIssue[] {
  const issues: LintIssue[] = [];
  const blob = `${opts.subject ?? ""}\n${opts.body}`;

  if (opts.mandateStatus === "paused") {
    issues.push({
      severity: "block",
      message: "This raise is paused — no draft until the principal reopens it.",
    });
  }
  if (opts.mandateCode === "HO" && opts.mandateStatus !== "active") {
    issues.push({
      severity: "block",
      message: "Hooley RF equity outreach is gated on Tony Hooley. Do not draft until he signs off.",
    });
  }
  if (opts.mandateCode === "SS" && PRIME.test(blob)) {
    issues.push({
      severity: "block",
      message: "Space Solar: do not use 'prime' framing. Position as needed by everybody.",
    });
  }
  if (opts.mandateCode === "SS" && NASDAQ.test(blob)) {
    const country = (opts.firmHqCountry ?? "").toLowerCase();
    const us = /\b(us|usa|united states|america)\b/.test(country);
    if (!us) {
      issues.push({
        severity: "block",
        message: "Space Solar Nasdaq intention is for US investors only.",
      });
    }
  }
  if (opts.mandateCode === "SK" && (opts.hasAttachment || PHOTO_HINT.test(blob))) {
    issues.push({
      severity: "block",
      message: "SkySails launch-from-ship photos are NDA — never store, never attach, never email.",
    });
  }
  if (opts.warmRequired && !opts.openerPresent) {
    issues.push({
      severity: "block",
      message: "There is a prior thread. The opener must reference it before a draft is allowed.",
    });
  }
  if (!blob.includes(CALENDLY_URL)) {
    issues.push({ severity: "flag", message: "Calendly link is missing." });
  }
  if (!blob.includes(TRISTAN_MOBILE)) {
    issues.push({ severity: "flag", message: "Sign-off must use +44 7776191944." });
  }
  if (WRONG_MOBILE.test(blob)) {
    issues.push({ severity: "block", message: "Wrong mobile number — use +44 7776191944." });
  }
  return issues;
}

export function warmOpenerLooksValid(opener: string, lastSubject: string | null): boolean {
  const text = opener.trim().toLowerCase();
  if (text.length < 12) return false;
  if (
    /\b(further to|following|good to|as discussed|last time|since we|after our|you and i|your note|your email)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (/\b20\d{2}\b/.test(text)) return true;
  const words = (lastSubject ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 4);
  return words.some((w) => text.includes(w));
}
