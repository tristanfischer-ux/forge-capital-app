import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase/server";

/**
 * In-app Opus 4.7 chat endpoint. Streams responses back to the client
 * so Tristan can ask questions / get advice / iterate on copy without
 * leaving the app or hitting a terminal.
 *
 * Scope V1: Q&A with awareness of the current route + active
 * campaign. Opus does NOT have write access to the codebase or the
 * database — it answers in text, suggests changes, lets Tristan
 * decide whether to apply them via the terminal. Tool-use / server-
 * action invocation is V2.
 *
 * Built 2026-04-23 in response to: "I want to have some kind of
 * functionality where I can talk to Opus 4.7 in the app for on the
 * fly updates or things which I'm thinking about".
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
    "You help Tristan think through the app, its flow, its copy, its data model, and its code. You are running in a chat widget that sits at the top of every authed page.",
    "",
    "Rules:",
    "  - British spelling (organise, behaviour, programme).",
    "  - Specific over generic. Cite file paths, route URLs, commit hashes when relevant.",
    "  - NEVER invent facts about the app that you cannot infer from the context you've been given. If you don't know, say so plainly.",
    "  - When Tristan asks for copy changes, match his voice: first-person, British, no flattery tokens (congratulations, great to see, loved your, enjoyed your, impressive work, excited to see), no bracketed placeholders like [X years] / [specific role], no marketing verbs like AI-powered / Smart / Intelligent.",
    "  - When he asks for code changes, propose them concisely with the file path + a brief description + the diff. Do not pretend you've applied them — you haven't; Tristan will apply via the terminal.",
    "  - Keep responses tight. He's scanning on a phone a lot of the time.",
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

  const system = systemLines.join("\n");

  const client = new Anthropic({ apiKey });
  const stream = await client.messages.stream({
    model: OPUS_MODEL,
    max_tokens: 4096,
    system,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`\n\n[stream error: ${msg}]`));
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
