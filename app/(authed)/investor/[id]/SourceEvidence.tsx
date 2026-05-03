"use client";

import { useEffect, useState } from "react";
import {
  getChunkEvidence,
  type ChunkEvidence,
} from "@/app/(authed)/match/match-v4-actions";

/**
 * Clean raw scraped text by stripping common website noise:
 * navigation menus, footers, cookie banners, social links, etc.
 */
function cleanChunkText(text: string): string {
  let cleaned = text;
  // Strip common navigation/menu patterns
  cleaned = cleaned.replace(/menu\s*/gi, "");
  cleaned = cleaned.replace(/kickass\s*companies\s*meet\s*the\s*team\s*get\s*off\s*the\s*couch/gi, "");
  cleaned = cleaned.replace(/overview\s*slashing\s*co\s*2/gi, "");
  // Strip footer boilerplate
  cleaned = cleaned.replace(/©\s*\d{4}[^.]*?\./g, "");
  cleaned = cleaned.replace(/linkedin\s*privacy/gi, "");
  cleaned = cleaned.replace(/put me in,?\s*coach[\s\S]*$/gi, "");
  cleaned = cleaned.replace(/my people will call your people[\s\S]*$/gi, "");
  // Strip "I want to work for" / "I want to connect with" patterns
  cleaned = cleaned.replace(/i want to work for\s+\w+/gi, "");
  cleaned = cleaned.replace(/i want to connect with\s+\w+/gi, "");
  // Collapse whitespace
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return cleaned;
}

/**
 * Split cleaned text into meaningful paragraphs at sentence boundaries
 * when the text is long enough to warrant it.
 */
function formatChunkText(text: string): string[] {
  const cleaned = cleanChunkText(text);
  if (cleaned.length < 200) return [cleaned];
  // Split on sentence boundaries, grouping into ~150-char paragraphs
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const paragraphs: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > 180 && current.length > 0) {
      paragraphs.push(current.trim());
      current = "";
    }
    current += (current ? " " : "") + s;
  }
  if (current.trim()) paragraphs.push(current.trim());
  return paragraphs.length > 0 ? paragraphs : [cleaned];
}

export function SourceEvidence({ investorId }: { investorId: number }) {
  const [chunks, setChunks] = useState<ChunkEvidence[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);

  useEffect(() => {
    try {
      const heroText = sessionStorage.getItem("heroText");
      if (!heroText) return;

      setLoading(true);
      getChunkEvidence({ investorId, heroText, limit: 8 })
        .then((res) => {
          if (res.ok && res.chunks.length > 0) {
            setChunks(res.chunks);
          } else if (res.ok && res.indexing) {
            setIndexing(true);
          } else if (!res.ok) {
            setError(res.error);
          }
        })
        .catch(() => setError("Failed to load evidence"))
        .finally(() => setLoading(false));
    } catch {}
  }, [investorId]);

  if (!loading && !chunks && !indexing) return null;

  return (
    <div className="m-section">
      <h3 style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-faint)",
            minWidth: 20,
          }}
        >
          §8
        </span>
        Source evidence
        {chunks ? (
          <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-dim)" }}>
            · {chunks.length} relevant excerpts from their website
          </span>
        ) : null}
      </h3>
      <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: -4, marginBottom: 8, lineHeight: 1.5 }}>
        Excerpts from this investor&rsquo;s website pages that best match your search. Used to assess thesis fit.
      </p>

      {loading ? (
        <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 13 }}>
          <span
            style={{
              display: "inline-block",
              width: 14,
              height: 14,
              border: "2px solid var(--border)",
              borderTopColor: "var(--accent)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              verticalAlign: "middle",
              marginRight: 8,
            }}
          />
          Searching scraped website pages for relevant excerpts…
        </div>
      ) : error ? (
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>{error}</p>
      ) : indexing ? (
        <p style={{ padding: "10px 14px", color: "var(--text-dim)", fontSize: 13, fontStyle: "italic" }}>
          No website excerpts yet — this investor's pages are still being indexed.
          Check back shortly.
        </p>
      ) : chunks ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {chunks.map((chunk, i) => {
            const domain = chunk.page_url
              .replace(/^https?:\/\//, "")
              .split("/")[0];
            const path = chunk.page_url
              .replace(/^https?:\/\/[^/]+/, "")
              .slice(0, 50);
            const paragraphs = formatChunkText(chunk.chunk_text);
            return (
              <div
                key={`${chunk.page_url}-${chunk.chunk_index}`}
                style={{
                  padding: "10px 14px",
                  border: "1px solid var(--border-soft)",
                  borderLeft: "3px solid var(--accent)",
                  borderRadius: 8,
                  background: "var(--surface-alt, #f8f9fa)",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {paragraphs.map((p, pi) => (
                  <p key={pi} style={{ margin: pi < paragraphs.length - 1 ? "0 0 6px 0" : 0, fontStyle: "italic", color: "var(--text)" }}>
                    &ldquo;{p}&rdquo;
                  </p>
                ))}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: 6,
                    fontSize: 11,
                    color: "var(--text-faint)",
                  }}
                >
                  <a
                    href={chunk.page_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--accent)" }}
                  >
                    {domain}
                    {path ? path : ""} ↗
                  </a>
                  <span>{Math.round(chunk.cosine_similarity * 100)}% match</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
