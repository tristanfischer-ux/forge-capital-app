"use client";

import type { ReactNode } from "react";

export function Hint({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="hint">
      {children}
      <span className="hint-bubble" role="tooltip">
        {label}
      </span>
    </span>
  );
}
