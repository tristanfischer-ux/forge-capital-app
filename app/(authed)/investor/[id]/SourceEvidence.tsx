"use client";

import React from "react";
import { useEffect, useState } from "react";
import {
  getChunkEvidence,
  type ChunkEvidence,
} from "@/app/(authed)/match/match-v4-actions";

/**
 * Render text with server-provided semantic highlight ranges.
 * Ranges are character offsets into the original chunk_text.
 */
function renderWithHighlights(
  text: string,
  highlights: [number, number][],
): React.ReactNode {
  if (highlights.length === 0) return text;

  // Sort and merge overlapping ranges
  const sorted = [...highlights].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of sorted) {
    if (merged.length > 0 && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else {
      merged.push([s, e]);
    }
  }

  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (let i = 0; i < merged.length; i++) {
    const [s, e] = merged[i];
    if (s > pos) {
      parts.push(
        <span key={`t${i}`}>{text.slice(pos, Math.min(s, text.length))}</span>,
      );
    }
    if (s < text.length) {
      parts.push(
        <mark
          key={`m${i}`}
          style={{
            background: "var(--accent-soft, #fff3cd)",
            color: "var(--text, #333)",
            borderRadius: 2,
            padding: "0 2px",
          }}
        >
          {text.slice(s, Math.min(e, text.length))}
        </mark>,
      );
    }
    pos = e;
  }
  if (pos < text.length) {
    parts.push(<span key="tail">{text.slice(pos)}</span>);
  }
  return parts;
}

export function SourceEvidence({ investorId }: { investorId: number }) {
  const [chunks, setChunks] = useState<ChunkEvidence[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);

  useEffect(() => {
    try {
      const ht = sessionStorage.getItem("heroText");
      if (!ht) return;

      setLoading(true);
      getChunkEvidence({ investorId, heroText: ht, limit: 8 })
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
          No website excerpts yet — this investor&rsquo;s pages are still being indexed.
          Check back shortly.
        </p>
      ) : chunks ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {chunks.map((chunk) => {
            const domain = chunk.page_url
              .replace(/^https?:\/\//, "")
              .split("/")[0];
            const path = chunk.page_url
              .replace(/^https?:\/\/[^/]+/, "")
              .slice(0, 50);
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
                <p style={{ margin: 0, color: "var(--text)" }}>
                  &ldquo;{renderWithHighlights(chunk.chunk_text, chunk.highlights)}&rdquo;
                </p>
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
