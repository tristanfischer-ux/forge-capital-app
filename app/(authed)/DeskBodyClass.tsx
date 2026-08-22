"use client";

import { useEffect } from "react";

export function DeskBodyClass({ kind }: { kind: "desk" | "legacy" }) {
  useEffect(() => {
    document.body.classList.toggle("desk", kind === "desk");
    document.body.classList.toggle("legacy", kind === "legacy");
    document.documentElement.classList.toggle("legacy", kind === "legacy");
    return () => {
      document.body.classList.remove("desk", "legacy");
      document.documentElement.classList.remove("legacy");
    };
  }, [kind]);
  return null;
}
