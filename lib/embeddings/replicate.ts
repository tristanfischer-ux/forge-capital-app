/**
 * Query-time embedding client for semantic match search.
 *
 * Matches the Forge Capital pipeline's choice: nomic-embed-text (768-dim,
 * `search_query:` prefix for queries, `search_document:` for docs). The
 * pipeline generates document vectors locally via Ollama and pushes them
 * to `investors_mirror.embedding vector(768)`. THIS file handles the
 * query side — embedding the founder's pitch at search time.
 *
 * Why Replicate: the pipeline's local Ollama can't be reached from Vercel
 * production. Replicate hosts the identical `nomic-ai/nomic-embed-text-v1.5`
 * model, so query vectors are compatible with the document vectors already
 * in Supabase — same 768-dim space, no re-embedding needed.
 *
 * Fallback: when `REPLICATE_API_TOKEN` is absent, returns null. Callers
 * must handle that path (fall back to lexical scoring).
 */

const REPLICATE_MODEL_OWNER = "nomic-ai";
const REPLICATE_MODEL_NAME = "nomic-embed-text-v1.5";

export interface ReplicateEmbedResult {
  ok: true;
  vector: number[];
  dims: number;
  model: string;
  latencyMs: number;
}

export interface ReplicateEmbedError {
  ok: false;
  error: string;
  kind: "no_token" | "http" | "shape" | "timeout";
}

/**
 * Embed a single query text. Uses the `search_query:` prefix per nomic's
 * convention — document embeddings in SQLite/Supabase use `search_document:`.
 * The two prefixes share a single vector space, so query and doc vectors
 * can be cosined directly.
 *
 * Returns null-shaped error when no token is configured so the caller can
 * degrade to lexical scoring honestly (no silent fallback).
 */
export async function embedQueryText(
  text: string,
): Promise<ReplicateEmbedResult | ReplicateEmbedError> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return {
      ok: false,
      error:
        "REPLICATE_API_TOKEN not set — semantic search disabled, falling back to lexical.",
      kind: "no_token",
    };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "Empty query text.",
      kind: "shape",
    };
  }

  // nomic's API takes a stringified JSON array of texts. One query per call
  // is fine; batching is a future optimisation when we run over multiple
  // pitch variants.
  const input = {
    texts: JSON.stringify([`search_query: ${trimmed.slice(0, 8000)}`]),
  };

  const started = Date.now();
  const url = `https://api.replicate.com/v1/models/${REPLICATE_MODEL_OWNER}/${REPLICATE_MODEL_NAME}/predictions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // `wait=30` asks Replicate to hold the connection for up to 30s and
        // return the completed prediction inline — skips polling. If the
        // prediction takes longer, we get 202 + a URL to poll. Nomic is
        // fast (<2s typical) so wait mode lands synchronously.
        Prefer: "wait=30",
      },
      body: JSON.stringify({ input }),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "fetch failed",
      kind: "http",
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      error: `Replicate ${response.status}: ${text.slice(0, 300)}`,
      kind: "http",
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "json parse failed",
      kind: "shape",
    };
  }

  // Response shape: { id, status, output: [[0.1, -0.2, ...]], ... }
  // If `status` is still "processing", the 30s wait expired — caller can
  // retry or degrade. Don't poll from here; keep the function single-shot.
  if (
    !body ||
    typeof body !== "object" ||
    !("status" in body) ||
    !("output" in body)
  ) {
    return {
      ok: false,
      error: "Unexpected Replicate response shape",
      kind: "shape",
    };
  }
  const b = body as { status: string; output: unknown };
  if (b.status !== "succeeded") {
    return {
      ok: false,
      error: `Replicate prediction status=${b.status} (expected succeeded)`,
      kind: "timeout",
    };
  }

  // `output` should be an array of embedding arrays. We sent one text,
  // so expect one vector.
  const outer = b.output;
  if (!Array.isArray(outer) || outer.length === 0) {
    return {
      ok: false,
      error: "Replicate output was empty or non-array",
      kind: "shape",
    };
  }
  const first = outer[0];
  if (!Array.isArray(first) || !first.every((n) => typeof n === "number")) {
    return {
      ok: false,
      error: "Replicate output[0] was not a number[]",
      kind: "shape",
    };
  }

  return {
    ok: true,
    vector: first as number[],
    dims: first.length,
    model: `${REPLICATE_MODEL_OWNER}/${REPLICATE_MODEL_NAME}`,
    latencyMs: Date.now() - started,
  };
}
