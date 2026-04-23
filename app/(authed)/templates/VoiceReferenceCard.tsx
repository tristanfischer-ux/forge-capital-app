"use client";

import { useState, useTransition } from "react";
import { saveVoiceReference } from "./actions";

/**
 * Voice Reference card on /templates — surfaces the per-campaign
 * founder_bio + voice_reference_email columns so Tristan can paste his
 * bio and a prior outbound email directly in the app (instead of SQL).
 *
 * Opus reads both columns when drafting each paragraph. Changing them
 * and saving is enough to improve the next Redraft pass.
 *
 * Built 2026-04-23 in response to *"this should be inside the app
 * itself. There should be a way of drafting it and having an AI audit
 * of it and tweaking it."*
 */
export default function VoiceReferenceCard(props: {
  campaignId: string;
  campaignName: string;
  initialFounderBio: string | null;
  initialVoiceReferenceEmail: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [bio, setBio] = useState(props.initialFounderBio ?? "");
  const [email, setEmail] = useState(props.initialVoiceReferenceEmail ?? "");
  const [isPending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bioSummary = props.initialFounderBio
    ? props.initialFounderBio.slice(0, 140) +
      (props.initialFounderBio.length > 140 ? "…" : "")
    : "No founder bio set — Opus will ask you to fill one in before drafting credibility.";

  const emailSummary = props.initialVoiceReferenceEmail
    ? `${props.initialVoiceReferenceEmail.split("\n")[0].slice(0, 140)}${props.initialVoiceReferenceEmail.length > 140 ? "…" : ""}`
    : "No voice reference email set — Opus relies on the rules doc only.";

  function onSave() {
    setError(null);
    setSavedAt(null);
    startTransition(async () => {
      const out = await saveVoiceReference({
        campaignId: props.campaignId,
        founderBio: bio,
        voiceReferenceEmail: email,
      });
      if (out.ok) {
        setSavedAt(new Date().toISOString().slice(11, 19) + " UTC");
      } else {
        setError(out.error);
      }
    });
  }

  return (
    <section
      className="section"
      style={{
        marginTop: 0,
        marginBottom: 18,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 16,
        boxShadow: "var(--shadow)",
      }}
      aria-label="Voice reference — founder bio + reference email"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "var(--accent-softer)",
            color: "var(--accent-dark)",
            fontWeight: 700,
            fontSize: 12,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-hidden="true"
        >
          V
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
            Voice reference &mdash; {props.campaignName}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              marginTop: 2,
            }}
          >
            Opus reads both of these when drafting every paragraph. Edit once per campaign.
          </div>
        </div>
        <button
          type="button"
          className="btn sm"
          onClick={() => setIsOpen((v) => !v)}
          style={{
            fontSize: 11,
            padding: "4px 10px",
            borderColor: "var(--accent)",
            color: "var(--accent)",
            background: "var(--accent-softer)",
            fontWeight: 600,
          }}
        >
          {isOpen ? "Close" : "Edit"}
        </button>
      </div>

      {!isOpen ? (
        <div
          style={{
            marginTop: 10,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            fontSize: 12,
            color: "var(--text-dim)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-faint)",
                marginBottom: 2,
              }}
            >
              Founder bio
            </div>
            <div style={{ lineHeight: 1.5 }}>{bioSummary}</div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-faint)",
                marginBottom: 2,
              }}
            >
              Voice reference email
            </div>
            <div style={{ lineHeight: 1.5 }}>{emailSummary}</div>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <label style={{ display: "block" }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text)",
                marginBottom: 4,
              }}
            >
              Founder bio
              <span
                style={{
                  fontWeight: 400,
                  color: "var(--text-dim)",
                  marginLeft: 6,
                }}
              >
                — one paragraph, first-person, specific numbers and named employers.
              </span>
            </div>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={6}
              placeholder="My name is Tristan Fischer. I have spent twenty-five years building, financing and scaling capital-intensive businesses — from..."
              style={{
                width: "100%",
                fontSize: 12,
                lineHeight: 1.55,
                padding: 8,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--surface-alt)",
                color: "var(--text)",
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
          </label>
          <label style={{ display: "block" }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text)",
                marginBottom: 4,
              }}
            >
              Voice reference email
              <span
                style={{
                  fontWeight: 400,
                  color: "var(--text-dim)",
                  marginLeft: 6,
                }}
              >
                — a full prior outbound email, pasted verbatim. Used as a few-shot exemplar.
              </span>
            </div>
            <textarea
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              rows={12}
              placeholder={
                "Dear Christophe,\n\nMy name is Tristan Fischer. I have spent twenty-five years..."
              }
              style={{
                width: "100%",
                fontSize: 12,
                lineHeight: 1.55,
                padding: 8,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--surface-alt)",
                color: "var(--text)",
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              className="btn sm primary"
              onClick={onSave}
              disabled={isPending}
              style={{
                fontSize: 12,
                padding: "6px 14px",
                background: "var(--accent)",
                borderColor: "var(--accent)",
                color: "#fff",
                fontWeight: 600,
              }}
            >
              {isPending ? "Saving…" : "Save voice reference"}
            </button>
            {savedAt ? (
              <span style={{ fontSize: 11, color: "var(--green)" }}>
                ✓ Saved at {savedAt} — next Redraft will use the new context.
              </span>
            ) : null}
            {error ? (
              <span style={{ fontSize: 11, color: "var(--red)" }}>{error}</span>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
