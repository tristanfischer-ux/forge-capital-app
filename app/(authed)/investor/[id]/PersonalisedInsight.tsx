"use client";

import { useEffect, useState } from "react";

interface Insight {
  why_might_back: string;
  how_to_pitch: string;
}

/**
 * Simple hash — mirrors the one in FindAMatch.tsx so cache keys match.
 */
function hashText(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export function PersonalisedInsight({ investorId }: { investorId: number }) {
  const [insight, setInsight] = useState<Insight | null>(null);

  useEffect(() => {
    try {
      // Read the current hero text from sessionStorage so the cache key
      // matches the one used by FindAMatch (insight:{id}:{heroHash}).
      // Previously this used insight:{id} which served stale SkySails
      // insights long after the founder typed a new pitch.
      const ht = sessionStorage.getItem("heroText") ?? "";
      const heroHash = hashText(ht);
      const cached = sessionStorage.getItem(`insight:${investorId}:${heroHash}`);
      if (cached) setInsight(JSON.parse(cached));
    } catch {}
  }, [investorId]);

  if (!insight) return null;

  return (
    <div className="m-section">
      <h3>Personalised insight</h3>
      {insight.why_might_back ? (
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--green, #16a34a)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            Why they might back you
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.65 }}>
            {insight.why_might_back}
          </p>
        </div>
      ) : null}
      {insight.how_to_pitch ? (
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--orange, #ea580c)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            How to pitch
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.65 }}>
            {insight.how_to_pitch}
          </p>
        </div>
      ) : null}
    </div>
  );
}
