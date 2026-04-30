"use client";

import { useRef, useState } from "react";

export interface PickedFile {
  name: string;
  size: number;
  type: string;
  base64: string;
}

const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentPicker({
  files,
  onChange,
}: {
  files: PickedFile[];
  onChange: (files: PickedFile[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  async function handleFiles(selected: FileList) {
    setError(null);
    const next = [...files];
    let runningTotal = totalSize;

    for (const file of Array.from(selected)) {
      if (runningTotal + file.size > MAX_TOTAL_BYTES) {
        setError(`Total attachments cannot exceed ${formatSize(MAX_TOTAL_BYTES)}.`);
        break;
      }
      const buf = await file.arrayBuffer();
      const base64 = Buffer.from(buf).toString("base64");
      next.push({ name: file.name, size: file.size, type: file.type || "application/octet-stream", base64 });
      runningTotal += file.size;
    }

    onChange(next);
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(index: number) {
    onChange(files.filter((_, i) => i !== index));
    setError(null);
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          style={{
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 600,
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "var(--surface)",
            color: "var(--text-dim)",
            cursor: "pointer",
          }}
        >
          Attach files
        </button>
        <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
          {totalSize > 0 ? `${formatSize(totalSize)} / ${formatSize(MAX_TOTAL_BYTES)}` : `Max ${formatSize(MAX_TOTAL_BYTES)} total`}
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      {error ? (
        <div style={{ fontSize: 11, color: "var(--red)", marginTop: 4 }}>{error}</div>
      ) : null}

      {files.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 8px",
                fontSize: 11,
                background: "var(--surface-alt)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text)",
              }}
            >
              <span>{f.name}</span>
              <span style={{ color: "var(--text-faint)", fontSize: 10 }}>
                ({formatSize(f.size)})
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-dim)",
                  fontSize: 13,
                  lineHeight: 1,
                  padding: 0,
                }}
                title="Remove"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
