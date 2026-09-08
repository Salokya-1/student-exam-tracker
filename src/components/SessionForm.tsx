"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { SubmitButton, useActionWithToast, type ActionResult, type FormAction } from "./ActionForm";
import { DAY_NAMES, minToTime } from "@/lib/constants";
import type { Clash } from "@/lib/engine/clash";
import { clashLabel } from "@/lib/engine/clash";

type Opt = { id: string; code?: string; name?: string };
type Initial = { id: string; moduleId: string; cohortId: string; lecturerId: string; roomId: string; slotId: string; sessionType: string; locked: boolean } | null;

export function SessionForm(props: {
  timetableId: string;
  initial: Initial;
  modules: (Opt & { requiresLab: boolean })[];
  cohorts: (Opt & { size: number })[];
  lecturers: Opt[];
  rooms: (Opt & { capacity: number; type: string })[];
  slots: { id: string; day: number; startMin: number }[];
  assignments: { moduleId: string; cohortId: string; lecturerId: string; sessionType: string }[];
  save: FormAction;
  remove?: FormAction;
  published: boolean;
}) {
  const { initial } = props;
  const [moduleId, setModuleId] = useState(initial?.moduleId ?? props.modules[0]?.id ?? "");
  const [cohortId, setCohortId] = useState(initial?.cohortId ?? props.cohorts[0]?.id ?? "");
  const [lecturerId, setLecturerId] = useState(initial?.lecturerId ?? props.lecturers[0]?.id ?? "");
  const [roomId, setRoomId] = useState(initial?.roomId ?? props.rooms[0]?.id ?? "");
  const [slotId, setSlotId] = useState(initial?.slotId ?? props.slots[0]?.id ?? "");
  const [sessionType, setSessionType] = useState(initial?.sessionType ?? "LECTURE");
  const saveWrapped = useActionWithToast(props.save);
  const removeWrapped = useActionWithToast(props.remove ?? (async () => null as ActionResult));
  const [, saveAction] = useActionState(saveWrapped, null);
  const [, removeAction] = useActionState(removeWrapped, null);
  const [result, setResult] = useState<{ clashes: Clash[]; freeRooms?: { id: string; code: string; capacity: number; type: string }[]; freeSlots?: { id: string; day: number; startMin: number }[] } | null>(null);
  const [checking, setChecking] = useState(false);

  // when module+cohort chosen, suggest the assigned lecturer
  useEffect(() => {
    const a = props.assignments.find((x) => x.moduleId === moduleId && x.cohortId === cohortId && x.sessionType === sessionType) ?? props.assignments.find((x) => x.moduleId === moduleId && x.cohortId === cohortId);
    if (a && !initial) setLecturerId(a.lecturerId);
  }, [moduleId, cohortId, sessionType, props.assignments, initial]);

  useEffect(() => {
    const ctrl = new AbortController();
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/timetable/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: initial?.id, timetableId: props.timetableId, moduleId, cohortId, lecturerId, roomId, slotId, sessionType }),
          signal: ctrl.signal,
        });
        setResult(await res.json());
      } catch {
        /* aborted */
      } finally {
        setChecking(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [moduleId, cohortId, lecturerId, roomId, slotId, sessionType, props.timetableId, initial?.id]);

  const cohort = props.cohorts.find((c) => c.id === cohortId);
  const room = props.rooms.find((r) => r.id === roomId);
  const hard = result?.clashes.filter((c) => c.severity === "HIGH") ?? [];
  const soft = result?.clashes.filter((c) => c.severity !== "HIGH") ?? [];
  const slotsByDay = useMemo(() => {
    const m = new Map<number, typeof props.slots>();
    for (const s of props.slots) m.set(s.day, [...(m.get(s.day) ?? []), s]);
    return m;
  }, [props.slots]);

  return (
    <form action={saveAction} className="grid lg:grid-cols-[1fr_380px] gap-8">
      <input type="hidden" name="id" value={initial?.id ?? ""} />
      <input type="hidden" name="timetableId" value={props.timetableId} />
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Module">
          <select name="moduleId" className="input" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            {props.modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} — {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Student group">
          <select name="cohortId" className="input" value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
            {props.cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.size} students
              </option>
            ))}
          </select>
        </Field>
        <Field label="Session type">
          <select name="sessionType" className="input" value={sessionType} onChange={(e) => setSessionType(e.target.value)}>
            <option>LECTURE</option>
            <option>TUTORIAL</option>
            <option>LAB</option>
          </select>
        </Field>
        <Field label="Lecturer">
          <select name="lecturerId" className="input" value={lecturerId} onChange={(e) => setLecturerId(e.target.value)}>
            {props.lecturers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Room ${room && cohort ? `· ${cohort.size}/${room.capacity} seats` : ""}`}>
          <select name="roomId" className="input" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            {props.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} · {r.type.toLowerCase()} · {r.capacity}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Time slot">
          <select name="slotId" className="input" value={slotId} onChange={(e) => setSlotId(e.target.value)}>
            {[...slotsByDay.entries()].map(([day, list]) => (
              <optgroup key={day} label={DAY_NAMES[day]}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {DAY_NAMES[s.day]} {minToTime(s.startMin)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-body md:col-span-2">
          <input type="checkbox" name="locked" defaultChecked={initial?.locked ?? false} /> Lock this session (the solver will keep it in place when regenerating)
        </label>
        {hard.length > 0 && (
          <label className="flex items-center gap-2 text-[13px] text-warn md:col-span-2">
            <input type="checkbox" name="override" /> Override hard conflicts (requires justification in the audit trail)
          </label>
        )}
        <div className="md:col-span-2 flex items-center gap-3 pt-2">
          <SubmitButton className="btn btn-primary" pendingText="Saving…">{initial ? "Save changes" : "Add session"}</SubmitButton>
          {props.remove && initial && (
            <button className="btn btn-ghost text-danger" formAction={removeAction} type="submit">
              Remove session
            </button>
          )}
          {props.published && <span className="text-[12px] text-muted">Editing the published timetable — changes are live immediately.</span>}
        </div>
      </div>

      <aside className="card card-pad h-fit">
        <div className="flex items-center justify-between">
          <div className="caps">Live conflict check</div>
          {checking && <span className="text-[11px] text-muted">checking…</span>}
        </div>
        {result && result.clashes.length === 0 && <p className="mt-3 text-success text-[13px]">No conflicts. Room, lecturer and group are free at this slot and the room fits the group.</p>}
        {hard.length > 0 && (
          <ul className="mt-3 space-y-2">
            {hard.map((c, i) => (
              <li key={i} className="border-l-2 border-rosso pl-3 text-[12px]">
                <div className="text-ink font-medium">{clashLabel(c.type)}</div>
                <div className="text-body">{c.message}</div>
              </li>
            ))}
          </ul>
        )}
        {soft.length > 0 && (
          <ul className="mt-3 space-y-2">
            {soft.map((c, i) => (
              <li key={i} className="border-l-2 border-warn pl-3 text-[12px]">
                <div className="text-ink font-medium">{clashLabel(c.type)}</div>
                <div className="text-body">{c.message}</div>
              </li>
            ))}
          </ul>
        )}
        {result?.freeRooms && result.freeRooms.length > 0 && (
          <div className="mt-5">
            <div className="caps mb-2">Free rooms at this slot</div>
            <div className="flex flex-wrap gap-2">
              {result.freeRooms.map((r) => (
                <button type="button" key={r.id} onClick={() => setRoomId(r.id)} className={`pill ${r.id === roomId ? "bg-rosso text-white" : "bg-elevated-3 text-ink hover:bg-elevated-2"}`}>
                  {r.code} · {r.capacity}
                </button>
              ))}
            </div>
          </div>
        )}
        {result?.freeSlots && result.freeSlots.length > 0 && (
          <div className="mt-5">
            <div className="caps mb-2">Slots free for room, lecturer &amp; group</div>
            <div className="flex flex-wrap gap-2">
              {result.freeSlots.map((s) => (
                <button type="button" key={s.id} onClick={() => setSlotId(s.id)} className={`pill ${s.id === slotId ? "bg-rosso text-white" : "bg-elevated-3 text-ink hover:bg-elevated-2"}`}>
                  {DAY_NAMES[s.day]} {minToTime(s.startMin)}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="caps block mb-2">{label}</span>
      {children}
    </label>
  );
}
