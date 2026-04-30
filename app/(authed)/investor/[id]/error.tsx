"use client";

export default function InvestorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="section" style={{ scrollMarginTop: 64 }}>
      <div className="section-head">
        <div>
          <h2 className="section-title">Something went wrong</h2>
          <p className="section-sub">
            This investor profile couldn&apos;t load. The data may be incomplete
            or in an unexpected format.
          </p>
        </div>
      </div>
      <div style={{ padding: "24px 0" }}>
        <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 16 }}>
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          onClick={reset}
          className="pill active"
          style={{ cursor: "pointer" }}
        >
          Try again
        </button>
      </div>
    </section>
  );
}
