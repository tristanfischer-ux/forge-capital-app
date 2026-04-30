/**
 * Shared OpenRouter helper — wraps all LLM calls for this app.
 *
 * All Anthropic SDK calls have been replaced with this helper
 * (migration 2026-04-30). Model selection per task:
 *
 *   - Voice-critical copy (outreach drafting, subject lines, reply
 *     classification + drafting): `openai/gpt-4.1`
 *   - Structured reasoning / synthesis (transcript synthesis, approval
 *     sheet parsing, pitch extraction): `deepseek/deepseek-v4-pro`
 *   - Simple extraction / classification (profile mode, approval
 *     reply parsing): `deepseek/deepseek-v4-flash`
 *
 * DeepSeek V4 models are reasoning models — they use a `reasoning_content`
 * field internally. The visible answer is always in `.choices[0].message.content`.
 * Set max_tokens >= 16000 for V4-Pro/Flash calls to avoid budget exhaustion
 * on the reasoning trace.
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
const HTTP_REFERER = "https://forge-capital-app.vercel.app";

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface CallOpenRouterParams {
  model: string;
  messages: OpenRouterMessage[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" | "text" };
}

/**
 * Standard non-streaming call. Returns the assistant's text content.
 * Throws if the request fails or the response is empty.
 */
export async function callOpenRouter(
  params: CallOpenRouterParams,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set in environment.");

  const res = await fetch(OPENROUTER_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": HTTP_REFERER,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.max_tokens ?? 4096,
      temperature: params.temperature ?? 0.3,
      ...(params.response_format
        ? { response_format: params.response_format }
        : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 400)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("OpenRouter returned empty content.");
  }
  return content.trim();
}

/**
 * Streaming variant for the opus-chat route.
 *
 * OpenRouter exposes an OpenAI-compatible streaming interface.
 * Each chunk is a server-sent event with a `data:` line containing
 * a JSON delta (`choices[0].delta.content`) or `[DONE]`.
 *
 * Tool use: OpenRouter/OpenAI format uses `tool_calls` in the
 * delta and a follow-up `tool` role message (not `tool_result`).
 *
 * Returns a ReadableStream<string> where each chunk is a raw SSE line.
 * The caller is responsible for parsing deltas.
 */
export async function streamOpenRouter(params: {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  max_tokens?: number;
  temperature?: number;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?: "auto" | "none";
}): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set in environment.");

  const res = await fetch(OPENROUTER_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": HTTP_REFERER,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.max_tokens ?? 4096,
      temperature: params.temperature ?? 0.3,
      stream: true,
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter stream ${res.status}: ${text.slice(0, 400)}`);
  }

  return res;
}
