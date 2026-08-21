"use client";

import { useState } from "react";

const MANDATES = [
  { code: "SS", label: "Space Solar" },
  { code: "SK", label: "SkySails" },
  { code: "FF", label: "FishFrom" },
  { code: "PA", label: "Panatere" },
  { code: "OD", label: "Odysseus" },
  { code: "CA", label: "Casper" },
  { code: "US", label: "US Arbitrage" },
  { code: "HO", label: "Hooley RF" },
];

type Hit = {
  kind: "firm" | "person";
  id: string;
  firm_id?: string;
  label: string;
  sub: string;
};

export function CapitalDiscover() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [mandate, setMandate] = useState("SS");
  const [msg, setMsg] = useState<string | null>(null);

  async function search() {
    const res = await fetch(`/api/capital-search?q=${encodeURIComponent(q)}`);
    const body = (await res.json()) as { hits?: Hit[] };
    setHits(body.hits ?? []);
  }

  async function add(hit: Hit) {
    const firmId = hit.kind === "firm" ? hit.id : hit.firm_id;
    if (!firmId) {
      setMsg("That person has no firm on the book.");
      return;
    }
    const res = await fetch("/api/capital-add-mandate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firm_id: firmId,
        person_id: hit.kind === "person" ? hit.id : null,
        mandate_code: mandate,
      }),
    });
    const body = (await res.json()) as { ok?: boolean; already?: boolean; error?: string; notes?: string };
    if (!body.ok) {
      setMsg(body.error ?? "Could not add — the database refused.");
      return;
    }
    setMsg(
      body.already
        ? "Already on that raise."
        : `On the raise.${body.notes ? " Constraint: " + body.notes.slice(0, 180) : ""}`,
    );
  }

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Discover — the shared book</h1>
          <p>
            Search the shared book — names, emails, near-miss spellings.
            Add someone to a raise. Nothing sends.
          </p>
        </div>
      </div>
      <div className="card" style={{ padding: 16 }}>
        <label className="faint">Search</label>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Gore Street, Lowercarbon, josh.wolfe@"
          style={{ width: "100%", fontSize: 16, padding: 10, margin: "4px 0 10px" }}
        />
        <label className="faint">Add to raise</label>
        <select
          value={mandate}
          onChange={(e) => setMandate(e.target.value)}
          style={{ width: "100%", fontSize: 16, padding: 10, margin: "4px 0 10px" }}
        >
          {MANDATES.map((m) => (
            <option key={m.code} value={m.code}>
              {m.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={search} disabled={q.trim().length < 2}>
          Search the book
        </button>
        {msg ? <p className="faint">{msg}</p> : null}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        {hits.length === 0 ? (
          <p className="sub">Type a name. Results come from core.firms and core.people.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Name</th>
                <th>Detail</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {hits.map((h) => (
                <tr key={`${h.kind}-${h.id}`}>
                  <td>{h.kind}</td>
                  <td>{h.label}</td>
                  <td>{h.sub}</td>
                  <td>
                    <button type="button" className="btn" onClick={() => add(h)}>
                      Add
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
