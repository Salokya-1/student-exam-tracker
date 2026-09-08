// Agent loop: OpenAI-compatible chat completions with function calling against
// the Experiential Labs gateway, with a deterministic fallback.
import type { CurrentUser } from "../auth";
import { ROLE_LABEL, TERMS } from "../constants";
import { classify, execute } from "../engine/nlq";
import { runTool, toolsForRole, toOpenAITools, serialise } from "./tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ToolTrace = { name: string; args: Record<string, unknown>; ok: boolean; summary: string };
export type AgentReply = { reply: string; tools: ToolTrace[]; navigateTo?: string; changed: boolean; engine: string; ms: number };

export function aiConfigured() {
  return Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY);
}
export const aiModel = () => process.env.AI_MODEL || "claude-haiku-4.5";
/** Stronger model for turns that ask the assistant to change something (better tool discipline). */
export const aiActionModel = () => process.env.AI_MODEL_ACTIONS || "claude-sonnet-4.5";
const ACTION_RX = /\b(create|add|new|delete|remove|update|change|edit|rename|set|enter|record|enrol|enroll|assign|reassign|generate|publish|approve|reject|reopen|submit|move|allocate|seat|prepare|reset|make|schedule|resolve|import|lock|unlock|retire|deactivate|activate|mark)\b/i;
export const looksLikeAction = (q: string) => ACTION_RX.test(q);

const GUIDE = `RTE Hub pages and what to do there:
- /dashboard — leadership overview: result pipeline, clashes, exam readiness, room utilisation, overloaded staff, at-risk students.
- /students — searchable directory; /students/{id} full academic profile (modules, marks, resits, progression, seats, weekly timetable).
- /results — result sheets per module × group. Workflow: DRAFT (lecturer enters marks inline or imports CSV) → SUBMITTED (lecturer submits; blocked while validation errors exist) → APPROVED (RTE officer/admin) → PUBLISHED (admin; applies outcomes, resits, progression, standing). Anomaly detection and validation are shown on each sheet.
- /timetable — weekly grid by group/lecturer/room; conflict monitor; "Generate clash-free option" runs the solver into a DRAFT; publish when 0 hard conflicts; Auto-resolve fixes drafts; "+ Add session" opens a form with a live conflict check; click a session to move it.
- /exams — sittings; each exam: 1) allocate venues 2) generate seating 3) assign invigilators → READY; print seating plan at /exams/{id}/print; seat lookup at /exams/seats.
- /faculty — contact hours vs limit, allocations (reassign to balance), invigilation duties. /rooms — inventory, utilisation heatmap, availability finder. /audit — every change.
- /me — student portal (own timetable, seats, published results).
You can also manage records directly: create/update/delete students, enrol them on modules, create result sheets and enter marks, add lecturers, rooms, modules and groups, create teaching allocations, add or delete timetable sessions, create/delete exams, and create logins or reset passwords. Use list_reference to discover valid codes (programmes, cohorts, modules, lecturers, rooms) before creating things.
Roles: ADMIN can do everything incl. publishing results; RTE_STAFF manages timetables, exams, rooms and approves results; LECTURER enters/submits marks for own modules; STUDENT sees only own data.`;

function systemPrompt(user: CurrentUser, path: string) {
  return `You are the RTE Hub assistant for Islington College's Routine, Timetable & Examination Department. You help staff and students operate the system and you can act inside it through tools.
Today is ${new Date().toDateString()}. Current teaching term ${TERMS.current}; results being processed for ${TERMS.processing}; ${TERMS.previous} is fully published.
User: ${user.name} (${ROLE_LABEL[user.role]}, role ${user.role}). They are currently on page ${path || "/"}.

${GUIDE}

Rules:
- Always answer from tool results; never invent students, rooms, numbers or ids. If you lack data, call a tool.
- You have NO memory of actions between turns and nothing happens unless you call a tool in the current turn. Every create/update/delete/enrol/generate/publish/approve request MUST be carried out by calling the matching tool now; never reply "Done", "Created", "Deleted" or similar unless a tool in this turn returned ok:true. If you decide not to act (e.g. you need confirmation), say clearly that nothing has been changed yet.
- When the user asks you to do something (generate, publish, allocate, seat, assign, approve, move…), do it with the action tools right away and then report exactly what happened, including counts and any blockers. Only ask for confirmation before publishing results, publishing a timetable, deleting, or overriding conflicts — and skip that if the user already said to go ahead.
- If a tool reports an error or a permission problem, explain it plainly and say who can do it or what must happen first.
- When something is worth looking at, include the page path as a markdown link, e.g. [open the sheet](/results/abc). Use open_page when the user asks to go somewhere.
- Be concise: short paragraphs or bullets, no headings, no emojis. Give step-by-step guidance when the user asks what to do or how to do something.`;
}

type OAIMessage = { role: string; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string; name?: string };

async function callLLM(messages: OAIMessage[], tools: ReturnType<typeof toOpenAITools>, model: string, toolChoice: "auto" | "required" = "auto") {
  const base = process.env.AI_BASE_URL!.replace(/\/$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 1200, messages, tools, tool_choice: toolChoice }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices?: { message?: OAIMessage; finish_reason?: string }[] };
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("Empty completion");
    return msg;
  } finally {
    clearTimeout(t);
  }
}

export async function runAgent(history: ChatMessage[], user: CurrentUser, path: string): Promise<AgentReply> {
  const t0 = Date.now();
  const traces: ToolTrace[] = [];
  let navigateTo: string | undefined;
  let changed = false;
  const last = history[history.length - 1]?.content ?? "";

  if (aiConfigured()) {
    try {
      const defs = toolsForRole(user.role);
      const tools = toOpenAITools(defs);
      const messages: OAIMessage[] = [{ role: "system", content: systemPrompt(user, path) }, ...history.slice(-14).map((m) => ({ role: m.role, content: m.content }))];
      const actionTurn = looksLikeAction(last);
      const model = actionTurn ? aiActionModel() : aiModel();
      let nudged = false;
      for (let i = 0; i < 8; i++) {
        const msg = await callLLM(messages, tools, model);
        if (!msg.tool_calls?.length) {
          const text = (msg.content ?? "").trim();
          // Guard: an action request answered with no tool call at all -> force one tool call once.
          if (actionTurn && traces.length === 0 && !nudged && !/\b(confirm|are you sure|shall i|do you want|should i|which|clarify|cannot|can't|not permitted|not allowed)\b/i.test(text)) {
            nudged = true;
            messages.push({ role: "assistant", content: text || null });
            messages.push({ role: "user", content: "You replied without calling any tool, so nothing was changed. Carry out the request now by calling the appropriate tool(s), then report the actual result." });
            const forced = await callLLM(messages, tools, model, "required");
            if (forced.tool_calls?.length) {
              messages.pop();
              messages.pop();
              Object.assign(msg, forced);
            } else {
              return { reply: `${text}

_(No changes were made — the assistant did not perform any action. Please rephrase or use the interface.)_`, tools: traces, navigateTo, changed, engine: `llm:${model}`, ms: Date.now() - t0 };
            }
          } else {
            return { reply: text || "Done.", tools: traces, navigateTo, changed, engine: `llm:${model}`, ms: Date.now() - t0 };
          }
        }
        const calls = msg.tool_calls ?? [];
        messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
        for (const tc of calls) {
          let args: Record<string, unknown> = {};
          try {
            args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            args = {};
          }
          let outcome;
          try {
            outcome = await runTool(tc.function.name, args, user);
          } catch (e) {
            outcome = { result: { error: (e as Error).message } };
          }
          const res = outcome.result as { error?: string; ok?: boolean } | undefined;
          const ok = !(res && (res.error || res.ok === false));
          traces.push({ name: tc.function.name, args, ok, summary: ok ? "ok" : String(res?.error ?? "failed") });
          if (outcome.navigateTo) navigateTo = outcome.navigateTo;
          if (outcome.changed) changed = true;
          messages.push({ role: "tool", tool_call_id: tc.id, name: tc.function.name, content: serialise(outcome.result) });
        }
      }
      return { reply: "I ran out of steps — here is what I did so far.", tools: traces, navigateTo, changed, engine: `llm:${model}`, ms: Date.now() - t0 };
    } catch (e) {
      const fb = await fallback(last, user);
      return { ...fb, reply: `${fb.reply}\n\n_(AI gateway unavailable: ${(e as Error).message.slice(0, 120)} — answered by the rule engine.)_`, tools: traces, ms: Date.now() - t0 };
    }
  }
  const fb = await fallback(last, user);
  return { ...fb, tools: [], ms: Date.now() - t0 };
}

/** Deterministic fallback: rule-based Q&A plus a few keyword actions. */
async function fallback(q: string, user: CurrentUser): Promise<Omit<AgentReply, "tools" | "ms">> {
  const lower = q.toLowerCase();
  const act = async (name: string, args: Record<string, unknown>) => {
    const o = await runTool(name, args, user);
    return { reply: `Ran **${name}**: ${serialise(o.result, 600)}`, navigateTo: o.navigateTo, changed: Boolean(o.changed), engine: "rule-engine" };
  };
  if (/\b(generate|create|make)\b.*\btimetable\b/.test(lower)) return act("generate_timetable", {});
  if (/\bauto.?resolve\b/.test(lower)) {
    const m = q.match(/tt-[\w-]+|c[a-z0-9]{20,}/i);
    if (m) return act("auto_resolve_conflicts", { timetableId: m[0] });
  }
  const exam = q.match(/\b([A-Z]{2}\d{4})\b/i)?.[1];
  if (exam && /\b(prepare|seat|seating|venue|invigilat)/.test(lower)) return act("prepare_exam", { examRef: exam.toUpperCase() });
  const c = classify(q);
  const a = await execute(c.intent, c.params);
  const links = a.links?.map((l) => `[${l.label}](${l.href})`).join(" · ");
  const rows = a.rows ? "\n\n" + a.rows.data.slice(0, 8).map((r) => "- " + r.join(" · ")).join("\n") : "";
  return { reply: `${a.answer}${rows}${links ? `\n\n${links}` : ""}`, changed: false, engine: "rule-engine" };
}
