"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Sticky Opus chat bar at the top of every authed page. Collapsed by
 * default into a one-line "Ask Opus 4.7…" input; opens into a message
 * stack with streaming replies when the user hits Enter. Stays pinned
 * as the page scrolls — per Tristan 2026-04-23 ask: "maybe it's just
 * a box which stays at the top which I can just tap into even if I
 * scroll down the page it's still always there and persistent."
 *
 * V2 (2026-04-23): tool-using. The server streams two kinds of
 * payload: plain text (Opus's prose) and `TOOL:<json>\n` lines
 * (tool-use + tool-result events). The client splits them out,
 * appending prose to the current assistant bubble and pushing tool
 * events into a per-message chip list that renders inline.
 *
 * Tool summaries stay short ("log_interaction ✓ call · 30m") so the
 * chip is legible next to the bubble. When Opus is still thinking
 * about a tool call, we render a "…" chip; once the result comes
 * back we swap in the summary.
 */

interface ToolChip {
  id: string;
  name: string;
  status: "pending" | "done" | "error";
  summary?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tools?: ToolChip[];
}

export function OpusChatBar(props: { activeCampaignName?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const pathname = usePathname();
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (expanded) {
      inputRef.current?.focus();
    }
  }, [expanded]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  async function onSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextMessages);
    setStreaming(true);

    // Placeholder assistant message that we fill as the stream arrives.
    setMessages([...nextMessages, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/opus-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          currentRoute: pathname,
          currentCampaignName: props.activeCampaignName ?? null,
        }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "stream failed");
        setMessages([
          ...nextMessages,
          { role: "assistant", content: `[error] ${errText}` },
        ]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pendingBuffer = ""; // holds bytes we haven't yet committed
      let prose = "";
      const chips: ToolChip[] = [];

      const flush = () => {
        setMessages([
          ...nextMessages,
          { role: "assistant", content: prose, tools: [...chips] },
        ]);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pendingBuffer += decoder.decode(value, { stream: true });

        // Walk the buffer, extracting `TOOL:<json>\n` lines where we
        // find them; everything else is prose.
        while (true) {
          const toolStart = pendingBuffer.indexOf("TOOL:");
          if (toolStart === -1) {
            // No tool line in the buffer — commit everything as prose.
            prose += pendingBuffer;
            pendingBuffer = "";
            break;
          }
          // Anything before the TOOL: marker is prose we can commit.
          if (toolStart > 0) {
            prose += pendingBuffer.slice(0, toolStart);
            pendingBuffer = pendingBuffer.slice(toolStart);
          }
          // Wait for the terminating newline before parsing.
          const lineEnd = pendingBuffer.indexOf("\n", 5);
          if (lineEnd === -1) break;
          const line = pendingBuffer.slice(5, lineEnd);
          pendingBuffer = pendingBuffer.slice(lineEnd + 1);
          try {
            const payload = JSON.parse(line) as {
              phase: "start" | "result";
              id: string;
              name: string;
              summary?: string;
              isError?: boolean;
            };
            if (payload.phase === "start") {
              chips.push({
                id: payload.id,
                name: payload.name,
                status: "pending",
              });
            } else {
              const chip = chips.find((c) => c.id === payload.id);
              if (chip) {
                chip.status = payload.isError ? "error" : "done";
                chip.summary = payload.summary;
              } else {
                chips.push({
                  id: payload.id,
                  name: payload.name,
                  status: payload.isError ? "error" : "done",
                  summary: payload.summary,
                });
              }
            }
          } catch {
            // Malformed tool line — drop it rather than polluting prose.
          }
        }

        flush();
      }
      // Commit any trailing buffer as prose.
      if (pendingBuffer) {
        prose += pendingBuffer;
        flush();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages([
        ...nextMessages,
        { role: "assistant", content: `[error] ${msg}` },
      ]);
    } finally {
      setStreaming(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    } else if (e.key === "Escape") {
      setExpanded(false);
    }
  }

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: expanded ? "10px 18px 12px" : "6px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            aria-hidden="true"
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "var(--accent-softer)",
              color: "var(--accent-dark)",
              fontWeight: 700,
              fontSize: 11,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✦
          </div>
          {!expanded ? (
            <input
              type="text"
              value={input}
              placeholder="Ask Opus 4.7 about this page, campaign, or app…"
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setExpanded(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && input.trim()) {
                  setExpanded(true);
                  setTimeout(onSend, 10);
                }
              }}
              style={{
                flex: 1,
                padding: "6px 10px",
                fontSize: 12,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--surface-alt)",
                color: "var(--text)",
                outline: "none",
              }}
            />
          ) : (
            <span
              style={{
                flex: 1,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text)",
              }}
            >
              Opus 4.7 · in-app assistant
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              color: "var(--text-faint)",
              marginRight: 8,
            }}
          >
            {pathname}
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              padding: "3px 10px",
              fontSize: 11,
              border: "1px solid var(--border)",
              background: expanded ? "var(--accent-softer)" : "var(--surface)",
              color: expanded ? "var(--accent-dark)" : "var(--text-dim)",
              borderRadius: 4,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            {expanded ? "Hide" : "Open"}
          </button>
        </div>

        {expanded ? (
          <>
            {messages.length > 0 ? (
              <div
                ref={messagesRef}
                style={{
                  maxHeight: 320,
                  overflowY: "auto",
                  padding: "8px 0",
                  borderTop: "1px solid var(--border-soft)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {messages.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "6px 10px",
                      background:
                        m.role === "user"
                          ? "var(--accent-softer)"
                          : "var(--surface-alt)",
                      borderRadius: 6,
                      fontSize: 12,
                      lineHeight: 1.55,
                      color: "var(--text)",
                      whiteSpace: "pre-wrap",
                      fontWeight: m.role === "user" ? 500 : 400,
                    }}
                  >
                    {m.tools && m.tools.length > 0 ? (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 4,
                          marginBottom: m.content ? 6 : 0,
                        }}
                      >
                        {m.tools.map((chip) => (
                          <span
                            key={chip.id}
                            title={chip.summary ?? chip.name}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "2px 6px",
                              fontSize: 10,
                              fontWeight: 500,
                              borderRadius: 3,
                              border: "1px solid var(--border-soft)",
                              background:
                                chip.status === "error"
                                  ? "rgba(220, 38, 38, 0.08)"
                                  : chip.status === "pending"
                                    ? "var(--surface)"
                                    : "var(--accent-softer)",
                              color:
                                chip.status === "error"
                                  ? "rgb(153, 27, 27)"
                                  : "var(--accent-dark)",
                              fontFamily:
                                "ui-monospace, SFMono-Regular, monospace",
                            }}
                          >
                            <span aria-hidden="true">🔧</span>
                            <span>
                              {chip.status === "pending"
                                ? `${chip.name} …`
                                : (chip.summary ?? chip.name)}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {m.content ||
                      (streaming &&
                      m.role === "assistant" &&
                      (!m.tools || m.tools.length === 0)
                        ? "▋"
                        : null)}
                  </div>
                ))}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Question, suggestion, or 'please change X on this page to Y'…"
                rows={2}
                disabled={streaming}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  fontSize: 12,
                  lineHeight: 1.5,
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--surface-alt)",
                  color: "var(--text)",
                  resize: "vertical",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={onSend}
                disabled={streaming || !input.trim()}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  border: "none",
                  background: streaming
                    ? "var(--text-faint)"
                    : "var(--accent)",
                  color: "#fff",
                  borderRadius: 6,
                  cursor: streaming ? "wait" : "pointer",
                }}
              >
                {streaming ? "…" : "Send"}
              </button>
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--text-faint)",
                lineHeight: 1.5,
              }}
            >
              Enter sends · Shift+Enter for new line · Esc closes. Opus sees
              the current route + campaign name. Code suggestions must be
              applied manually via terminal — in-app chat does not write
              to the codebase or DB.
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
