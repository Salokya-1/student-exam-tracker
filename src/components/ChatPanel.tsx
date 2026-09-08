"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles, Send, Trash2, CheckCircle2, XCircle } from "lucide-react";

type Trace = { name: string; args: Record<string, unknown>; ok: boolean; summary: string };
type Msg = { role: "user" | "assistant"; content: string; tools?: Trace[]; engine?: string; ms?: number; error?: boolean };

const STORAGE = "rte-chat-v1";

const TIPS: { match: RegExp; tips: string[] }[] = [
  { match: /^\/dashboard/, tips: ["What needs my attention today?", "Which lecturers are overloaded?", "How far along is result processing?"] },
  { match: /^\/timetable/, tips: ["Generate a new clash-free timetable option", "Show conflicts in the legacy draft and auto-resolve them", "Is LB-201 free on Wednesday at 9?"] },
  { match: /^\/results\/[^/]+/, tips: ["Explain the anomalies on this sheet", "Approve this sheet", "What blocks submission here?"] },
  { match: /^\/results/, tips: ["Which sheets are waiting for approval?", "Pass rate for CS4005", "Publish all approved sheets for 2026-SPR"] },
  { match: /^\/exams\/[^/]+/, tips: ["Prepare this exam: venues, seating, invigilators", "Who is invigilating here?", "Open the printable seating plan"] },
  { match: /^\/exams/, tips: ["Which exams are not ready yet?", "Prepare the CS5001 exam", "Where is 20250252 sitting?"] },
  { match: /^\/students\/[^/]+/, tips: ["Summarise this student's record", "Is this student at risk?", "When is their next exam?"] },
  { match: /^\/students/, tips: ["At-risk students in L6COG1", "Find Anisha Ghimire", "Students on probation"] },
  { match: /^\/faculty/, tips: ["Workload of Sunita Maharjan", "Who is overloaded and how do I fix it?", "Move CS5001 lecture for L5COG1 to Anjali Gurung"] },
  { match: /^\/rooms/, tips: ["Which rooms are free on Tuesday at 10 for 40 students?", "Least used rooms", "How busy is Kumari Hall?"] },
  { match: /^\/me/, tips: ["What classes do I have today?", "Where is my next exam seat?", "Show my published results"] },
  { match: /.*/, tips: ["What can you do?", "Generate a clash-free timetable", "Prepare the CS4001 exam", "Which sheets are waiting for approval?"] },
];

export function tipsFor(path: string) {
  return TIPS.find((t) => t.match.test(path))!.tips;
}

/** Tiny markdown: **bold**, bullets, [text](/path) links, _italics_, newlines. */
export function renderMarkdown(text: string): ReactNode {
  const lines = text.split(/\r?\n/);
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="list-disc pl-5 space-y-1 my-1">
          {list}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((line, i) => {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) {
      list.push(<li key={i}>{inline(m[1])}</li>);
      return;
    }
    flush();
    if (line.trim() === "") return;
    out.push(
      <p key={i} className="my-1">
        {inline(line)}
      </p>,
    );
  });
  flush();
  return <>{out}</>;
}

function inline(s: string): ReactNode {
  const parts: ReactNode[] = [];
  const rx = /\[([^\]]+)\]\((\/[^)\s]*)\)|\*\*([^*]+)\*\*|`([^`]+)`|_([^_]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = rx.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    if (m[1]) parts.push(<Link key={k++} href={m[2]} className="underline text-ink hover:text-rosso">{m[1]}</Link>);
    else if (m[3]) parts.push(<strong key={k++} className="text-ink font-semibold">{m[3]}</strong>);
    else if (m[4]) parts.push(<code key={k++} className="text-[12px] bg-elevated-3 px-1">{m[4]}</code>);
    else if (m[5]) parts.push(<em key={k++} className="text-muted">{m[5]}</em>);
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return <>{parts}</>;
}

export function ChatPanel({ compact = false, onClose }: { compact?: boolean; onClose?: () => void }) {
  const path = usePathname();
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE);
      if (raw) setMsgs(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE, JSON.stringify(msgs.slice(-40)));
    } catch {}
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-14).map((m) => ({ role: m.role, content: m.role === "assistant" && m.tools?.length ? `${m.content}

[tools used in that turn: ${m.tools.map((t) => `${t.name}${t.ok ? "" : " (failed)"}`).join(", ")}]` : m.content })), path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMsgs((m) => [...m, { role: "assistant", content: data.reply, tools: data.tools, engine: data.engine, ms: data.ms }]);
      if (data.changed) router.refresh();
      if (data.navigateTo && data.navigateTo !== path) router.push(data.navigateTo);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `Something went wrong: ${(e as Error).message}`, error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const tips = tipsFor(path ?? "/");

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={`flex items-center gap-3 border-b border-hairline ${compact ? "px-4 py-3" : "px-6 py-4"}`}>
        <span className="inline-block h-5 w-1.5 bg-rosso" />
        <div className="min-w-0">
          <div className="text-ink text-[13px] font-semibold tracking-wide">RTE ASSISTANT</div>
          <div className="text-[11px] text-muted truncate">Ask anything, or tell me what to do — I can act in the system</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" title="Clear conversation" className="btn btn-ghost btn-sm px-2" onClick={() => setMsgs([])}>
            <Trash2 size={14} />
          </button>
          {onClose && (
            <button type="button" className="btn btn-ghost btn-sm px-2" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
      </div>

      <div className={`flex-1 min-h-0 overflow-y-auto ${compact ? "px-4 py-3" : "px-6 py-5"} space-y-4`}>
        {msgs.length === 0 && (
          <div className="text-[13px] text-body">
            <p className="mb-3">
              I can look things up (seats, timetables, free rooms, workloads, results, conflicts) and <span className="text-ink">do the work</span>: generate and publish timetables, resolve clashes, prepare exams, move sessions, reassign teaching, and push result sheets through approval — all within your role&apos;s permissions.
            </p>
            <div className="caps mb-2">Try on this page</div>
            <div className="flex flex-col gap-1.5">
              {tips.map((t) => (
                <button key={t} type="button" onClick={() => send(t)} className="text-left text-[13px] text-body hover:text-ink border-l-2 border-hairline-2 hover:border-rosso pl-3 py-0.5 transition-colors">
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="bg-elevated-3 text-ink px-3 py-2 max-w-[85%] text-[13px] whitespace-pre-wrap">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="flex gap-3">
              <span className={`inline-block h-5 w-1.5 shrink-0 mt-1 ${m.error ? "bg-danger" : "bg-rosso"}`} />
              <div className="min-w-0 flex-1 text-[13px] text-body leading-relaxed">
                {renderMarkdown(m.content)}
                {m.tools && m.tools.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.tools.map((t, k) => (
                      <span key={k} title={`${JSON.stringify(t.args)} → ${t.summary}`} className={`pill ${t.ok ? "bg-[rgba(3,144,74,0.18)] text-[#39c27c]" : "bg-[rgba(241,58,44,0.18)] text-[#ff6b60]"}`}>
                        {t.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {t.name.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
                {m.engine && <div className="mt-1 text-[10px] text-muted">{m.engine} · {m.ms} ms</div>}
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="flex gap-3">
            <span className="inline-block h-5 w-1.5 shrink-0 mt-1 bg-rosso animate-pulse" />
            <div className="text-[13px] text-muted">Working…</div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {msgs.length > 0 && !busy && (
        <div className={`flex gap-1.5 overflow-x-auto ${compact ? "px-4" : "px-6"} pb-2 no-scrollbar`}>
          {tips.slice(0, 3).map((t) => (
            <button key={t} type="button" onClick={() => send(t)} className="pill bg-elevated-3 text-body hover:text-ink whitespace-nowrap normal-case tracking-normal font-normal text-[11px]">
              {t}
            </button>
          ))}
        </div>
      )}
      <form
        className={`border-t border-hairline flex gap-2 ${compact ? "p-3" : "p-4"}`}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input ref={inputRef} className="input input-sm" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. Prepare the CS5001 exam" disabled={busy} autoFocus={!compact} />
        <button className="btn btn-primary btn-sm px-3" disabled={busy || !input.trim()} aria-label="Send">
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}

export function ChatIcon({ size = 18 }: { size?: number }) {
  return <Sparkles size={size} strokeWidth={1.75} />;
}
