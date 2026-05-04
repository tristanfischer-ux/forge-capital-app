"use client";

import React from "react";
import { useEffect, useState } from "react";
import {
  getChunkEvidence,
  type ChunkEvidence,
} from "@/app/(authed)/match/match-v4-actions";

/**
 * Extract meaningful terms from text for highlighting.
 * Filters out generic investment/domain words that appear on every
 * investor's website — only terms that actually distinguish relevance.
 */
function extractHighlightTerms(text: string): string[] {
  const GENERIC = new Set([
    // Standard English stopwords
    "the","a","an","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could",
    "should","may","might","shall","can","need","dare","ought",
    "used","to","of","in","for","on","with","at","by","from",
    "as","into","through","during","before","after","above","below",
    "between","out","off","over","under","again","further","then",
    "once","and","but","or","nor","not","so","very","just",
    "than","too","also","about","up","that","this","these","those",
    "what","which","who","whom","when","where","why","how","all",
    "each","every","both","few","more","most","other","some","such",
    "no","only","own","same","its","it","they","them","their",
    "we","our","you","your","he","she","him","her","his",
    // Generic investment-domain words (appear on EVERY investor site)
    "looking","seeking","find","investors","funds","venture",
    "capital","investment","fund","backing","portfolio","invest",
    "investing","invested","companies","startups","firm","firms",
    "team","management","partners","based","focused","focus",
    "experience","across","including","provide","provides",
    "support","working","work","great","good","new","best",
    "world","leading","innovative","growth","early","stage",
    "late","series","round","seed","pre","post","equity",
    "debt","private","public","market","markets","sector",
    "industries","global","local","region","regional","north",
    "south","east","west","europe","america","asia","africa",
    "uk","us","eu","usd","gbp","eur","m","mm","b","bn",
    "per","cent","percent","year","years","since","current",
    "date","today","tomorrow","yesterday","read","learn","see",
    "click","visit","contact","home","page","site","back",
    "next","previous","menu","skip","content","main","toggle",
    "navigate","go","let","make","sure","way","things",
    "systems","technology","including","developing","infrastructure",
    "building","operation","using","transforming","industries",
    "companies","company","startup","starts","startups",
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !GENERIC.has(t))
    .filter((t, i, arr) => arr.indexOf(t) === i);
}

/**
 * Highlight matching terms in text. Only highlights terms that appear
 * as whole words (word-boundary aware).
 */
function highlightTerms(
  text: string,
  terms: string[],
): React.ReactNode {
  if (terms.length === 0) return text;
  // Build word-boundary-aware regex
  const pattern = new RegExp(
    `\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
    "gi",
  );
  const parts = text.split(pattern);
  return parts.map((part, i) => {
    const isMatch = terms.some((t) => part.toLowerCase() === t);
    if (isMatch) {
      return (
        <mark
          key={i}
          style={{
            background: "var(--accent-soft, #fff3cd)",
            color: "var(--text, #333)",
            borderRadius: 2,
            padding: "0 2px",
          }}
        >
          {part}
        </mark>
      );
    }
    return part;
  });
}

/**
 * Clean raw scraped text by stripping common website noise.
 */
function cleanChunkText(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/menu\s*/gi, "");
  cleaned = cleaned.replace(/kickass\s*companies\s*meet\s*the\s*team\s*get\s*off\s*the\s*couch/gi, "");
  cleaned = cleaned.replace(/overview\s*slashing\s*co\s*2/gi, "");
  cleaned = cleaned.replace(/©\s*\d{4}[^.]*?\./g, "");
  cleaned = cleaned.replace(/linkedin\s*privacy/gi, "");
  cleaned = cleaned.replace(/put me in,?\s*coach[\s\S]*$/gi, "");
  cleaned = cleaned.replace(/my people will call your people[\s\S]*$/gi, "");
  cleaned = cleaned.replace(/i want to work for\s+\w+/gi, "");
  cleaned = cleaned.replace(/i want to connect with\s+\w+/gi, "");
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return cleaned;
}

export function SourceEvidence({ investorId }: { investorId: number }) {
  const [chunks, setChunks] = useState<ChunkEvidence[] | null>(null);
  const [heroText, setHeroText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);

  useEffect(() => {
    try {
      const ht = sessionStorage.getItem("heroText");
      if (!ht) return;
      setHeroText(ht);

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

  const terms = heroText ? extractHighlightTerms(heroText) : [];

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
            const cleaned = cleanChunkText(chunk.chunk_text);
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
                  &ldquo;{highlightTerms(cleaned, terms)}&rdquo;
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
