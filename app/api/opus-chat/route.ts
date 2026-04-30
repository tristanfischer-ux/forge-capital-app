import { createServerClient } from "@/lib/supabase/server";
import { CHAT_TOOLS, dispatchTool } from "./tools";

/**
 * In-app GPT-4.1 chat endpoint (migrated from Anthropic Opus 4.7
 * to OpenRouter on 2026-04-30). Streams responses back to the client.
 *
 * V2 (2026-04-23): tool-using. The model can call search_partners,
 * resolve_campaign_partner, log_interaction, refine_synthesis — each
 * is a thin wrapper around an existing server action (see ./tools.ts).
 *
 * Wire format sent to the client:
 *   - Normal text deltas are emitted as plain UTF-8 bytes.
 *   - Tool events are emitted on their own line prefixed with `TOOL:`
 *     followed by a JSON blob and a trailing newline, e.g.
 *       TOOL:{"name":"search_partners","summary":"…","phase":"result"}\n
 *     The client parses these out before appending plain text to the
 *     assistant bubble.
 *
 * Tool loop is capped at 5 iterations per user turn to prevent runaway.
 * Q&A-only conversations (no tool use) fall through the loop once and
 * stream identically to the V1 implementation — no regression.
 *
 * OpenAI tool-use protocol (used by OpenRouter):
 *   - Tools are defined as { type: "function", function: { name, description, parameters } }
 *   - Model emits `tool_calls` array in the delta when invoking tools
 *   - Results are sent back as { role: "tool", tool_call_id, content }
 */

export const runtime = "nodejs";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  currentRoute?: string;
  currentCampaignName?: string | null;
}

// Voice-critical interactive chat — use GPT-4.1 for quality.
const CHAT_MODEL = "openai/gpt-4.1";
const MAX_TOOL_ITERATIONS = 5;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
const HTTP_REFERER = "https://forge-capital-app.vercel.app";

// Convert Anthropic-style tool definitions to OpenAI function-calling format.
function toOpenAITools(tools: typeof CHAT_TOOLS) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response("OPENROUTER_API_KEY not set", { status: 500 });
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return new Response("No messages", { status: 400 });
  }

  const systemLines = [
    "You are an in-app assistant inside the Forge Capital app (fractional-forge outreach tool Tristan Fischer built for his fundraising work).",
    "",
    "You help Tristan think through the app, its flow, its copy, its data model, and its code. You also have tools that let you make real changes to his outreach database on his behalf. You are running in a chat widget that sits at the top of every authed page.",
    "",
    "Rules:",
    "  - British spelling (organise, behaviour, programme).",
    "  - Specific over generic. Cite file paths, route URLs, commit hashes when relevant.",
    "  - NEVER invent facts about the app that you cannot infer from the context you've been given. If you don't know, say so plainly.",
    "  - When Tristan asks for copy changes, match his voice: first-person, British, no flattery tokens (congratulations, great to see, loved your, enjoyed your, impressive work, excited to see), no bracketed placeholders like [X years] / [specific role], no marketing verbs like AI-powered / Smart / Intelligent.",
    "  - When he asks for code changes, propose them concisely with the file path + a brief description + the diff. Do not pretend you've applied them — you haven't; Tristan will apply via the terminal.",
    "  - Keep responses tight. He's scanning on a phone a lot of the time.",
    "",
    "TOOL USE:",
    "  - You have tools. Use them when the user asks for something concrete (log a call, refine a synthesis, find a partner). Do NOT hallucinate action outcomes; always wait for the tool result before claiming something happened.",
    "  - Before calling log_interaction, ALWAYS call search_partners to resolve the partner name to an id. Never invent a partner_id — if search_partners returns nothing, tell Tristan the partner isn't in the database and stop.",
    "  - When calling log_interaction, set event_type to one of: call | meeting | linkedin_message | linkedin_connect | whatsapp | slack | personal_note | handover_note | intel. Use 'call' by default for voice conversations.",
    "  - If the user pastes a Wispr transcript and says 'log this call with X', call log_interaction with the transcript as notes and run_synthesis=true (the action auto-synthesises).",
    "  - refine_synthesis needs a campaign_partner_id (a uuid). If the user names a partner, chain search_partners → resolve_campaign_partner → refine_synthesis.",
    "  - After tools run, give Tristan a one-line confirmation of what landed — e.g. 'Logged a 30-min call with Astasia Myers at Quiet Capital, follow-up set for Thursday.' Do not repeat the raw JSON.",
    "",
    "Current app context:",
  ];
  if (body.currentRoute) {
    systemLines.push(`  - Current route: ${body.currentRoute}`);
  }
  if (body.currentCampaignName) {
    systemLines.push(`  - Active campaign: ${body.currentCampaignName}`);
  }
  systemLines.push(`  - Signed-in user id: ${user.id}`);
  systemLines.push(`  - Now: ${new Date().toISOString()}`);

  const system = systemLines.join("\n");
  const openAITools = toOpenAITools(CHAT_TOOLS);

  // Running conversation history sent to the model. Mutable across
  // tool iterations — we append assistant responses + tool result turns.
  type HistoryMessage = {
    role: string;
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
    name?: string;
  };

  const history: HistoryMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const emitText = (text: string) => {
        controller.enqueue(encoder.encode(text));
      };
      const emitTool = (payload: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`\nTOOL:${JSON.stringify(payload)}\n`),
        );
      };

      try {
        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          // Make a streaming request to OpenRouter.
          const response = await fetch(OPENROUTER_BASE, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": HTTP_REFERER,
            },
            body: JSON.stringify({
              model: CHAT_MODEL,
              max_tokens: 4096,
              stream: true,
              tools: openAITools,
              tool_choice: "auto",
              messages: [
                { role: "system", content: system },
                ...history,
              ],
            }),
          });

          if (!response.ok || !response.body) {
            const errText = await response.text().catch(() => "");
            emitText(`\n\n[OpenRouter error ${response.status}: ${errText.slice(0, 200)}]`);
            break;
          }

          // Parse SSE stream from OpenRouter.
          // Each line is either `data: <json>` or `data: [DONE]`.
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          // Accumulate tool calls across the stream.
          const pendingToolCalls: Map<
            number,
            { id: string; name: string; argumentsJson: string }
          > = new Map();
          let assistantTextContent = "";
          let finishReason: string | null = null;

          outer: while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const data = trimmed.slice(5).trim();
              if (data === "[DONE]") break outer;
              let chunk: {
                choices?: Array<{
                  delta?: {
                    content?: string | null;
                    tool_calls?: Array<{
                      index?: number;
                      id?: string;
                      type?: string;
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                  finish_reason?: string | null;
                }>;
              };
              try {
                chunk = JSON.parse(data);
              } catch {
                continue;
              }
              const choice = chunk.choices?.[0];
              if (!choice) continue;
              const delta = choice.delta;

              if (delta?.content) {
                assistantTextContent += delta.content;
                emitText(delta.content);
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!pendingToolCalls.has(idx)) {
                    pendingToolCalls.set(idx, {
                      id: tc.id ?? `tool_${idx}`,
                      name: tc.function?.name ?? "",
                      argumentsJson: "",
                    });
                    // Emit tool start event.
                    emitTool({
                      phase: "start",
                      id: tc.id ?? `tool_${idx}`,
                      name: tc.function?.name ?? "",
                    });
                  }
                  const pending = pendingToolCalls.get(idx)!;
                  if (tc.id) pending.id = tc.id;
                  if (tc.function?.name) pending.name = tc.function.name;
                  if (tc.function?.arguments) {
                    pending.argumentsJson += tc.function.arguments;
                  }
                }
              }

              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
              }
            }
          }

          // Push the assistant turn onto history.
          const toolCallsForHistory =
            pendingToolCalls.size > 0
              ? Array.from(pendingToolCalls.values()).map((tc) => ({
                  id: tc.id,
                  type: "function" as const,
                  function: { name: tc.name, arguments: tc.argumentsJson },
                }))
              : undefined;

          history.push({
            role: "assistant",
            content: assistantTextContent || null,
            ...(toolCallsForHistory ? { tool_calls: toolCallsForHistory } : {}),
          });

          // If no tool calls or non-tool finish, we're done.
          if (
            pendingToolCalls.size === 0 ||
            (finishReason && finishReason !== "tool_calls")
          ) {
            break;
          }

          // Execute each tool call and push results back.
          const toolResults = await Promise.all(
            Array.from(pendingToolCalls.values()).map(async (tc) => {
              let input: unknown;
              try {
                input = JSON.parse(tc.argumentsJson || "{}");
              } catch {
                input = {};
              }
              const result = await dispatchTool(tc.name, input, { supabase });
              emitTool({
                phase: "result",
                id: tc.id,
                name: tc.name,
                summary: result.summary,
                isError: result.isError ?? false,
              });
              return { tc, result };
            }),
          );

          // Append tool result messages (OpenAI protocol: role="tool").
          for (const { tc, result } of toolResults) {
            history.push({
              role: "tool",
              tool_call_id: tc.id,
              name: tc.name,
              content: JSON.stringify(result.data).slice(0, 20_000),
            });
          }

          if (iter === MAX_TOOL_ITERATIONS - 1) {
            emitText(
              "\n\n[Tool loop hit the 5-iteration cap — stopping to avoid runaway.]",
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emitText(`\n\n[stream error: ${msg}]`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
