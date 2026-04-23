"use client";

import { useState, useTransition } from "react";
import {
  logInteraction,
  type SynthesisedActions,
  type LogInteractionInput,
} from "./logInteractionAction";

type EventType = LogInteractionInput["eventType"];

const EVENT_TYPES: Array<{ value: EventType; label: string }> = [
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "linkedin_message", label: "LinkedIn message" },
  { value: "linkedin_connect", label: "LinkedIn connect" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "slack", label: "Slack" },
  { value: "personal_note", label: "Personal note" },
  { value: "handover_note", label: "Handover note (to company side)" },
  { value: "intel", label: "Intel (lasting fact)" },
];

const CHANNELS: Array<{ value: NonNullable<LogInteractionInput["channel"]>; label: string }> = [
  { value: "call", label: "Phone call" },
  { value: "zoom", label: "Zoom" },
  { value: "google_meet", label: "Google Meet" },
  { value: "teams", label: "Microsoft Teams" },
  { value: "in_person", label: "In person" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "signal", label: "Signal" },
  { value: "slack", label: "Slack" },
  { value: "manual", label: "Other / manual" },
];

export function LogInteractionButton(props: {
  partnerId?: number;
  campaignPartnerId?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 600,
          border: "1px solid var(--accent)",
          background: "var(--accent)",
          color: "#fff",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        {props.label ?? "+ Log call / meeting / note"}
      </button>
      {open ? (
        <LogInteractionModal
          partnerId={props.partnerId}
          campaignPartnerId={props.campaignPartnerId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function LogInteractionModal(props: {
  partnerId?: number;
  campaignPartnerId?: string;
  onClose: () => void;
}) {
  const [eventType, setEventType] = useState<EventType>("call");
  const [channel, setChannel] = useState<NonNullable<LogInteractionInput["channel"]>>("call");
  const [eventAt, setEventAt] = useState<string>(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    // datetime-local format "YYYY-MM-DDTHH:MM"
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [title, setTitle] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<string>("30");
  const [notes, setNotes] = useState("");
  const [followUpDueAt, setFollowUpDueAt] = useState<string>("");
  const [runSynthesis, setRunSynthesis] = useState(true);

  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { kind: "idle" }
    | {
        kind: "saved";
        synthesis: SynthesisedActions | null;
      }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const isDictationType = eventType === "call" || eventType === "meeting";
  const isShortType =
    eventType === "linkedin_connect" ||
    eventType === "personal_note" ||
    eventType === "intel";

  function onSave() {
    if (isPending) return;
    startTransition(async () => {
      const out = await logInteraction({
        partnerId: props.partnerId,
        campaignPartnerId: props.campaignPartnerId,
        eventType,
        channel,
        eventAt: new Date(eventAt).toISOString(),
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
        title: title || undefined,
        notes: notes || undefined,
        followUpDueAt: followUpDueAt
          ? new Date(followUpDueAt).toISOString()
          : undefined,
        runSynthesis: runSynthesis && !!notes && notes.length >= 120,
      });
      if (out.ok) {
        setResult({ kind: "saved", synthesis: out.synthesis });
      } else {
        setResult({ kind: "error", message: out.error });
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-label="Log interaction"
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(15, 23, 42, 0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "40px 20px",
        overflow: "auto",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          background: "var(--surface)",
          borderRadius: 12,
          border: "1px solid var(--border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2
            style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}
          >
            Log interaction
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            style={{
              padding: "4px 8px",
              fontSize: 12,
              border: "1px solid var(--border)",
              background: "transparent",
              borderRadius: 4,
              cursor: "pointer",
              color: "var(--text-dim)",
            }}
          >
            Esc
          </button>
        </header>

        {result.kind !== "saved" ? (
          <>
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "1fr 1fr",
              }}
            >
              <label style={{ display: "block" }}>
                <span
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: "var(--text-dim)",
                  }}
                >
                  Type
                </span>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value as EventType)}
                  style={inputStyle()}
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block" }}>
                <span
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: "var(--text-dim)",
                  }}
                >
                  Channel
                </span>
                <select
                  value={channel}
                  onChange={(e) =>
                    setChannel(
                      e.target.value as NonNullable<
                        LogInteractionInput["channel"]
                      >,
                    )
                  }
                  style={inputStyle()}
                >
                  {CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "2fr 1fr",
              }}
            >
              <label style={{ display: "block" }}>
                <span
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: "var(--text-dim)",
                  }}
                >
                  When
                </span>
                <input
                  type="datetime-local"
                  value={eventAt}
                  onChange={(e) => setEventAt(e.target.value)}
                  style={inputStyle()}
                />
              </label>
              {isDictationType ? (
                <label style={{ display: "block" }}>
                  <span
                    style={{
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      color: "var(--text-dim)",
                    }}
                  >
                    Duration (min)
                  </span>
                  <input
                    type="number"
                    value={durationMinutes}
                    min={0}
                    max={600}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                    style={inputStyle()}
                  />
                </label>
              ) : null}
            </div>

            <label style={{ display: "block" }}>
              <span
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: "var(--text-dim)",
                }}
              >
                Title
              </span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  eventType === "call"
                    ? "e.g. Intro call with Marianne"
                    : eventType === "meeting"
                      ? "e.g. Coffee at Station F"
                      : "Short title"
                }
                style={inputStyle()}
              />
            </label>

            <label style={{ display: "block" }}>
              <span
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: "var(--text-dim)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <span>
                  Notes{" "}
                  {isDictationType ? (
                    <span
                      style={{
                        color: "var(--text-faint)",
                        textTransform: "none",
                        letterSpacing: 0,
                        marginLeft: 4,
                      }}
                    >
                      — paste Wispr transcript here
                    </span>
                  ) : null}
                </span>
                {notes.length >= 120 ? (
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 400,
                      color: "var(--text-dim)",
                      textTransform: "none",
                      letterSpacing: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={runSynthesis}
                      onChange={(e) => setRunSynthesis(e.target.checked)}
                    />
                    Synthesise with Opus on save
                  </label>
                ) : null}
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={isShortType ? 4 : 10}
                placeholder={
                  isDictationType
                    ? "Paste the full Wispr transcript. Opus will extract a summary, action items, intel and quotes when you save."
                    : "Notes, observations, anything worth keeping."
                }
                style={{
                  ...inputStyle(),
                  resize: "vertical",
                  fontFamily: "inherit",
                  minHeight: isShortType ? 80 : 180,
                }}
              />
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-faint)",
                  marginTop: 2,
                }}
              >
                {notes.length} chars
                {notes.length >= 120 && runSynthesis
                  ? " · Opus synthesis will run on save (~4s)"
                  : notes.length < 120
                    ? " · paste at least 120 chars to enable synthesis"
                    : ""}
              </div>
            </label>

            <label style={{ display: "block" }}>
              <span
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: "var(--text-dim)",
                }}
              >
                Follow up by (optional)
              </span>
              <input
                type="datetime-local"
                value={followUpDueAt}
                onChange={(e) => setFollowUpDueAt(e.target.value)}
                style={inputStyle()}
              />
            </label>

            {result.kind === "error" ? (
              <div
                style={{
                  padding: "8px 10px",
                  background: "var(--red-light)",
                  border: "1px solid var(--red)",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "var(--red)",
                }}
              >
                {result.message}
              </div>
            ) : null}

            <footer
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 4,
              }}
            >
              <button
                type="button"
                onClick={props.onClose}
                disabled={isPending}
                style={{
                  padding: "8px 14px",
                  fontSize: 13,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  borderRadius: 6,
                  cursor: "pointer",
                  color: "var(--text)",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={isPending}
                style={{
                  padding: "8px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  borderRadius: 6,
                  cursor: isPending ? "wait" : "pointer",
                }}
              >
                {isPending
                  ? notes.length >= 120 && runSynthesis
                    ? "Saving + synthesising…"
                    : "Saving…"
                  : "Save interaction"}
              </button>
            </footer>
          </>
        ) : (
          <SavedSuccessView
            synthesis={result.synthesis}
            onClose={props.onClose}
          />
        )}
      </div>
    </div>
  );
}

function SavedSuccessView(props: {
  synthesis: SynthesisedActions | null;
  onClose: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          padding: "8px 12px",
          background: "var(--green-light)",
          border: "1px solid var(--green)",
          borderRadius: 6,
          fontSize: 12,
          color: "var(--green)",
          fontWeight: 600,
        }}
      >
        ✓ Saved to the timeline.
      </div>

      {props.synthesis ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 14,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
            Opus synthesis
          </div>
          {props.synthesis.summary.length > 0 ? (
            <section>
              <HeadLabel>Summary</HeadLabel>
              <ul style={bulletStyle()}>
                {props.synthesis.summary.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {props.synthesis.action_items.length > 0 ? (
            <section>
              <HeadLabel>Action items</HeadLabel>
              <ul style={bulletStyle()}>
                {props.synthesis.action_items.map((a, i) => (
                  <li key={i}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        color:
                          a.owner === "tristan"
                            ? "var(--accent-dark)"
                            : a.owner === "company"
                              ? "var(--amber)"
                              : "var(--text-dim)",
                        marginRight: 6,
                      }}
                    >
                      {a.owner}
                    </span>
                    {a.text}
                    {a.due_at_guess ? (
                      <span
                        style={{
                          color: "var(--text-dim)",
                          fontSize: 11,
                          marginLeft: 6,
                        }}
                      >
                        · due {a.due_at_guess}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {props.synthesis.intel.length > 0 ? (
            <section>
              <HeadLabel>Intel worth remembering</HeadLabel>
              <ul style={bulletStyle()}>
                {props.synthesis.intel.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {props.synthesis.quotes.length > 0 ? (
            <section>
              <HeadLabel>Quotes</HeadLabel>
              <ul style={bulletStyle()}>
                {props.synthesis.quotes.map((s, i) => (
                  <li key={i} style={{ fontStyle: "italic" }}>
                    &ldquo;{s}&rdquo;
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {props.synthesis.suggested_status ||
          props.synthesis.suggested_follow_up_due_at ? (
            <section
              style={{
                display: "flex",
                gap: 14,
                fontSize: 12,
                paddingTop: 8,
                borderTop: "1px solid var(--border)",
              }}
            >
              {props.synthesis.suggested_status ? (
                <span>
                  <b>Suggested status:</b>{" "}
                  <code>{props.synthesis.suggested_status}</code>
                </span>
              ) : null}
              {props.synthesis.suggested_follow_up_due_at ? (
                <span>
                  <b>Suggested follow-up:</b>{" "}
                  {props.synthesis.suggested_follow_up_due_at}
                </span>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}

      <footer
        style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
      >
        <button
          type="button"
          onClick={props.onClose}
          style={{
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Done
        </button>
      </footer>
    </div>
  );
}

function HeadLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        color: "var(--text-dim)",
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function bulletStyle(): React.CSSProperties {
  return {
    margin: 0,
    paddingLeft: 18,
    fontSize: 12,
    lineHeight: 1.55,
    color: "var(--text)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  };
}

function inputStyle(): React.CSSProperties {
  return {
    marginTop: 4,
    width: "100%",
    padding: "6px 10px",
    fontSize: 13,
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--surface-alt)",
    color: "var(--text)",
    outline: "none",
  };
}
