"use client";

import { useState } from "react";

export function CollapsibleSection({
  number,
  title,
  children,
  defaultOpen = false,
  previewLines = 3,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  previewLines?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="m-section" style={{ position: "relative" }}>
      <h3
        style={{ display: "flex", alignItems: "baseline", gap: 8, cursor: "pointer" }}
        onClick={() => setOpen(!open)}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-faint)",
            minWidth: 20,
          }}
        >
          §{number}
        </span>
        {title}
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--text-faint)",
            transition: "transform 0.2s ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          ▼
        </span>
      </h3>
      <div
        style={{
          overflow: "hidden",
          maxHeight: open ? "none" : `${previewLines * 1.65 * 14}px`,
          position: "relative",
        }}
      >
        {children}
        {!open ? (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 40,
              background: "linear-gradient(transparent, var(--surface, white))",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              paddingBottom: 4,
            }}
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(true); }}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "3px 12px",
                fontSize: 11,
                color: "var(--text-dim)",
                background: "var(--surface, white)",
                cursor: "pointer",
              }}
            >
              Show more ▼
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
