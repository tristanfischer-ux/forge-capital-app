/**
 * Query-time embedding client for semantic match search — OpenAI
 * text-embedding-3-small with `dimensions: 768` (matryoshka-truncated
 * so it fits the existing `investors_mirror.embedding vector(768)`
 * column).
 *
 * Why OpenAI over Replicate: the Forge Capital static dashboard uses
 * locally-hosted nomic-embed-text via browser-side Ollama — that can't
 * be reached from Vercel. Replicate doesn't host nomic publicly (model
 * returned 404 on every candidate owner). OpenAI does hosted
 * embeddings reliably, cheaply, and supports custom dimensions so we
 * keep the existing schema.
 *
 * **Critical**: document vectors must also be embedded with THIS model
 * for retrieval to work — they're not compatible with nomic vectors.
 * The `scripts/embed-investors.mjs` job re-embeds all
 * `investors_mirror` rows via the same model. Don't mix the two.
 *
 * Cost: text-embedding-3-small is $0.02/1M tokens. Typical query
 * (~50 tokens) = $0.000001. 20 queries/day = $0.0006/month. Free.
 *
 * Fallback: when OPENAI_API_KEY is absent, returns kind=no_token and
 * the caller degrades to lexical.
 */

const MODEL = "text-embedding-3-small";
const DIMENSIONS = 768;

export interface OpenAIEmbedResult {
  ok: true;
  vector: number[];
  dims: number;
  model: string;
  tokens: number;
  latencyMs: number;
}

export interface OpenAIEmbedError {
  ok: false;
  error: string;
  kind: "no_token" | "http" | "shape";
}

export async function embedQueryText(
  text: string,
): Promise<OpenAIEmbedResult | OpenAIEmbedError> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) {
    return {
      ok: false,
      error:
        "OPENAI_API_KEY not set — semantic search disabled, falling back to lexical.",
      kind: "no_token",
    };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: "Empty query text.", kind: "shape" };
  }

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        dimensions: DIMENSIONS,
        // OpenAI's embeddings endpoint caps input at ~8192 tokens.
        // Clamp the raw chars to avoid a 400 on oversized pitch text.
        input: trimmed.slice(0, 24000),
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "fetch failed",
      kind: "http",
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      error: `OpenAI ${response.status}: ${body.slice(0, 300)}`,
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

  if (
    !body ||
    typeof body !== "object" ||
    !("data" in body) ||
    !Array.isArray((body as { data: unknown }).data)
  ) {
    return { ok: false, error: "Unexpected OpenAI response shape", kind: "shape" };
  }
  const b = body as {
    data: Array<{ embedding?: unknown }>;
    usage?: { total_tokens?: number };
    model?: string;
  };
  const first = b.data[0]?.embedding;
  if (!Array.isArray(first) || !first.every((n) => typeof n === "number")) {
    return {
      ok: false,
      error: "OpenAI returned no embedding vector",
      kind: "shape",
    };
  }

  return {
    ok: true,
    vector: first as number[],
    dims: first.length,
    model: b.model ?? MODEL,
    tokens: b.usage?.total_tokens ?? 0,
    latencyMs: Date.now() - started,
  };
}
