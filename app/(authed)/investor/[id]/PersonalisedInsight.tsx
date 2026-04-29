"use client";

import { useEffect, useState } from "react";

interface Insight {
  why_might_back: string;
  how_to_pitch: string;
}

export function PersonalisedInsight({ investorId }: { investorId: number }) {
  const [insight, setInsight] = useState<Insight | null>(null);

  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(`insight:${investorId}`);
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
