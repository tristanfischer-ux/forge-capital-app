"use client";

import { useEffect } from "react";

export function RememberCall({ id }: { id: string }) {
  useEffect(() => {
    document.cookie = `fc_current_call=${encodeURIComponent(id)}; path=/; max-age=2592000; samesite=lax`;
  }, [id]);
  return null;
}
