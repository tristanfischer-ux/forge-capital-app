"use client";

import { useEffect, useState } from "react";

const DB = "raise-desk-log";
const STORE = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueLocal(row: Record<string, string>) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function pending(): Promise<Record<string, string>[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as Record<string, string>[]);
    req.onerror = () => reject(req.error);
  });
}

async function drop(id: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function flush() {
  const rows = await pending();
  for (const row of rows) {
    const res = await fetch("/api/desk-touch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    if (res.ok) await drop(row.id);
  }
}

export function QuickLog() {
  const [who, setWho] = useState("");
  const [channel, setChannel] = useState("whatsapp");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => {
      setOnline(true);
      flush().catch(() => undefined);
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    if (navigator.onLine) flush().catch(() => undefined);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  async function save() {
    const row = {
      id: `q-${Date.now()}`,
      who,
      channel,
      note,
      queued_at: new Date().toISOString(),
    };
    if (!navigator.onLine) {
      await queueLocal(row);
      setMsg("Saved on this phone. It will flush when you have signal.");
      setNote("");
      return;
    }
    const res = await fetch("/api/desk-touch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string };
    if (!body.ok) {
      await queueLocal(row);
      setMsg(body.error ?? "Could not reach the desk — queued on the phone.");
      return;
    }
    setMsg("Logged. Nothing sent.");
    setNote("");
  }

  return (
    <div>
      <p className="faint">{online ? "Online" : "Offline — will queue on this phone"}</p>
      <label className="faint">Who</label>
      <input
        value={who}
        onChange={(e) => setWho(e.target.value)}
        placeholder="Gareth, Tony, Miha…"
        style={{ width: "100%", fontSize: 16, padding: 10, margin: "4px 0 10px" }}
      />
      <label className="faint">Channel</label>
      <select
        value={channel}
        onChange={(e) => setChannel(e.target.value)}
        style={{ width: "100%", fontSize: 16, padding: 10, margin: "4px 0 10px" }}
      >
        <option value="whatsapp">WhatsApp</option>
        <option value="imessage">iMessage</option>
        <option value="call">Call</option>
        <option value="in_person">In person</option>
      </select>
      <label className="faint">What happened</label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={5}
        style={{ width: "100%", fontSize: 16, padding: 10, margin: "4px 0 10px" }}
      />
      <button type="button" className="btn btn-primary" disabled={!who.trim() || !note.trim()} onClick={save}>
        Log this
      </button>
      {msg ? <p className="faint">{msg}</p> : null}
    </div>
  );
}
