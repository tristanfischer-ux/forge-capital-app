import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ContentBlockParam,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { createServerClient } from "@/lib/supabase/server";
import { CHAT_TOOLS, dispatchTool } from "./tools";

/**
 * In-app Opus 4.7 chat endpoint. Streams responses back to the client.
 *
 * V2 (2026-04-23): tool-using. Opus can call search_partners,
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

const OPUS_MODEL = "claude-opus-4-7";
const MAX_TOOL_ITERATIONS = 5;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response("ANTHROPIC_API_KEY not set", { status: 500 });
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
    "You are Claude Opus 4.7, embedded as an in-app assistant inside the Forge Capital app (fractional-forge outreach tool Tristan Fischer built for his fundraising work).",
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
    "  - You have tools. Use them when the user asks for something concrete (log a call, refine a synthesis, find a partner). Do NOT hallucinate action outcomes; always wait for the tool_result before claiming something happened.",
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

  const client = new Anthropic({ apiKey });

  // Running conversation history sent to Opus. We mutate this across
  // tool iterations by appending assistant responses + user-role
  // tool_result turns per the Anthropic tool-use protocol.
  const history: MessageParam[] = messages.map((m) => ({
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
          const stream = client.messages.stream({
            model: OPUS_MODEL,
            max_tokens: 4096,
            system,
            tools: CHAT_TOOLS,
            messages: history,
          });

          // Accumulate tool-use blocks during the stream so we can
          // execute them once the message finishes.
          const toolUseBlocks: Array<{
            index: number;
            id: string;
            name: string;
            inputJson: string;
          }> = [];

          for await (const event of stream) {
            if (event.type === "content_block_start") {
              const block = event.content_block;
              if (block.type === "tool_use") {
                toolUseBlocks.push({
                  index: event.index,
                  id: block.id,
                  name: block.name,
                  inputJson: "",
                });
                emitTool({
                  phase: "start",
                  id: block.id,
                  name: block.name,
                });
              }
            } else if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                emitText(event.delta.text);
              } else if (event.delta.type === "input_json_delta") {
                const pending = toolUseBlocks.find(
                  (b) => b.index === event.index,
                );
                if (pending) {
                  pending.inputJson += event.delta.partial_json;
                }
              }
            }
          }

          const finalMessage = await stream.finalMessage();
          const stopReason = finalMessage.stop_reason;

          // Assemble the assistant message we need to push back onto
          // history — Anthropic's protocol requires the assistant
          // tool_use blocks before we send tool_result.
          const assistantContent: ContentBlockParam[] = [];
          for (const block of finalMessage.content) {
            if (block.type === "text") {
              assistantContent.push({ type: "text", text: block.text });
            } else if (block.type === "tool_use") {
              assistantContent.push({
                type: "tool_use",
                id: block.id,
                name: block.name,
                input: block.input,
              });
            }
          }
          history.push({ role: "assistant", content: assistantContent });

          if (stopReason !== "tool_use" || toolUseBlocks.length === 0) {
            // Either a clean end_turn or max_tokens — nothing to
            // dispatch, exit the loop.
            break;
          }

          // Execute every tool_use in parallel, then push the batch of
          // tool_result blocks as a single user-role message.
          const toolResultBlocks: ContentBlockParam[] = [];
          const results = await Promise.all(
            finalMessage.content
              .filter(
                (b): b is Extract<typeof b, { type: "tool_use" }> =>
                  b.type === "tool_use",
              )
              .map(async (block) => {
                const result = await dispatchTool(block.name, block.input, {
                  supabase,
                });
                return { block, result };
              }),
          );

          for (const { block, result } of results) {
            emitTool({
              phase: "result",
              id: block.id,
              name: block.name,
              summary: result.summary,
              isError: result.isError ?? false,
            });
            toolResultBlocks.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result.data).slice(0, 20_000),
              is_error: result.isError ?? false,
            });
          }

          history.push({ role: "user", content: toolResultBlocks });

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
