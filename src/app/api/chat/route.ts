import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runAgent, type ChatMessage } from "@/lib/agent/run";
import { audit } from "@/lib/audit";

export const maxDuration = 120;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json()) as { messages?: ChatMessage[]; path?: string };
  const messages = (body.messages ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()).slice(-20);
  if (!messages.length) return NextResponse.json({ error: "Say something first" }, { status: 400 });
  const result = await runAgent(messages, user, body.path ?? "/");
  await audit(user.id, "ASSISTANT_CHAT", "Assistant", null, { q: messages[messages.length - 1].content.slice(0, 300), engine: result.engine, tools: result.tools.map((t) => `${t.name}:${t.ok ? "ok" : "fail"}`), ms: result.ms });
  return NextResponse.json(result);
}
