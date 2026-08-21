"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Hit = {
  kind: "person" | "firm";
  id: number | string;
  label: string;
  sub: string | null;
};

export function DeskSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const query = q.trim();
      if (query.length < 2) {
        setHits([]);
        return;
      }
      fetch(`/api/desk-search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((body) => setHits(Array.isArray(body.hits) ? body.hits : []))
        .catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="desk-search" ref={box}>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Find a person or firm…"
        aria-label="Find a person or firm"
      />
      {open && hits.length > 0 ? (
        <ul className="desk-search-list">
          {hits.map((h) => (
            <li key={`${h.kind}-${h.id}`}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setQ("");
                  if (!h.id) return;
                  router.push(h.kind === "person" ? `/person/${h.id}` : `/firm/${h.id}`);
                }}
              >
                <strong>{h.label}</strong>
                <span>{h.kind === "person" ? "Person" : "Firm"}{h.sub ? ` · ${h.sub}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
