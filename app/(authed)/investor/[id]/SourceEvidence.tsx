"use client";

import { useEffect, useState } from "react";
import {
  getChunkEvidence,
  type ChunkEvidence,
} from "@/app/(authed)/match/match-v4-actions";

export function SourceEvidence({ investorId }: { investorId: number }) {
  const [chunks, setChunks] = useState<ChunkEvidence[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const heroText = sessionStorage.getItem("heroText");
      if (!heroText) return;

      setLoading(true);
      getChunkEvidence({ investorId, heroText, limit: 8 })
        .then((res) => {
          if (res.ok && res.chunks.length > 0) {
            setChunks(res.chunks);
          } else if (!res.ok) {
            setError(res.error);
          }
        })
        .catch(() => setError("Failed to load evidence"))
        .finally(() => setLoading(false));
    } catch {}
  }, [investorId]);

  if (!loading && !chunks) return null;

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
      ) : chunks ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {chunks.map((chunk, i) => {
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
                <p style={{ margin: 0, fontStyle: "italic", color: "var(--text)" }}>
                  &ldquo;{chunk.chunk_text}&rdquo;
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
