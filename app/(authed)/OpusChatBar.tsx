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
 * Scope V1: Q&A only. Opus cannot write code or mutate the DB from
 * this path. When Tristan wants a code change, Opus proposes the
 * edit as text; he applies it via the terminal.
 */

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages([
          ...nextMessages,
          { role: "assistant", content: acc },
        ]);
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
                    {m.content ||
                      (streaming && m.role === "assistant"
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
