"use client";

import { useMemo, useState, useTransition } from "react";
import { computeResult, type AssessmentLite, type MarkRow } from "@/lib/engine/grading";
import type { MarkEntry } from "@/app/(app)/results/actions";

export function MarksGrid({
  sheetId,
  rows,
  assessments,
  editable,
  save,
}: {
  sheetId: string;
  rows: MarkRow[];
  assessments: AssessmentLite[];
  editable: boolean;
  save: (sheetId: string, entries: MarkEntry[]) => Promise<{ ok: boolean; error?: string; changed?: number }>;
}) {
  const [data, setData] = useState<Record<string, Record<string, string>>>(() => {
    const init: Record<string, Record<string, string>> = {};
    for (const r of rows) {
      init[r.enrollmentId] = {};
      for (const a of assessments) init[r.enrollmentId][a.id] = r.marks[a.id] === null || r.marks[a.id] === undefined ? "" : String(r.marks[a.id]);
    }
    return init;
  });
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const computed = useMemo(() => {
    const out: Record<string, ReturnType<typeof computeResult>> = {};
    for (const r of rows) {
      const marks: Record<string, number | null> = {};
      for (const a of assessments) {
        const v = data[r.enrollmentId]?.[a.id] ?? "";
        marks[a.id] = v === "" ? null : Number(v);
      }
      out[r.enrollmentId] = computeResult({ ...r, marks }, assessments);
    }
    return out;
  }, [data, rows, assessments]);

  const onChange = (eid: string, aid: string, v: string) => {
    setData((d) => ({ ...d, [eid]: { ...d[eid], [aid]: v } }));
    setDirty((s) => new Set(s).add(`${eid}|${aid}`));
  };

  const onSave = () => {
    const entries: MarkEntry[] = [];
    for (const key of dirty) {
      const [eid, aid] = key.split("|");
      const v = data[eid][aid];
      entries.push({ enrollmentId: eid, assessmentId: aid, marks: v === "" ? null : Number(v) });
    }
    start(async () => {
      const res = await save(sheetId, entries);
      setMsg(res.ok ? `Saved ${res.changed} mark(s)` : res.error ?? "Failed");
      if (res.ok) setDirty(new Set());
    });
  };

  const visible = rows.filter((r) => !filter || r.studentNo.includes(filter) || r.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-hairline no-print">
        <input className="input input-sm w-64" placeholder="Filter by name or number" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="text-[12px] text-muted">
          {visible.length} of {rows.length} students
        </span>
        {editable && (
          <div className="ml-auto flex items-center gap-3">
            {msg && <span className="text-[12px] text-body">{msg}</span>}
            {dirty.size > 0 && <span className="text-[12px] text-warn">{dirty.size} unsaved change(s)</span>}
            <button className="btn btn-primary btn-sm" onClick={onSave} disabled={pending || dirty.size === 0}>
              {pending ? "Saving…" : "Save marks"}
            </button>
          </div>
        )}
      </div>
      <div className="scroll-x max-h-[640px] overflow-auto">
        <table className="table">
          <thead className="sticky top-0 bg-elevated z-[1]">
            <tr>
              <th>#</th>
              <th>Student no.</th>
              <th>Name</th>
              {assessments.map((a) => (
                <th key={a.id} className="text-right">
                  {a.name} <span className="text-muted normal-case tracking-normal">({a.weight}% · /{a.maxMarks})</span>
                </th>
              ))}
              <th className="text-right">Overall</th>
              <th>Grade</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const c = computed[r.enrollmentId];
              return (
                <tr key={r.enrollmentId}>
                  <td className="num text-muted">{i + 1}</td>
                  <td className="num ink">{r.studentNo}</td>
                  <td className="ink">
                    {r.name}
                    {r.attempt > 1 && <span className="ml-2 pill bg-elevated-3 text-ink">resit</span>}
                  </td>
                  {assessments.map((a) => {
                    const v = data[r.enrollmentId]?.[a.id] ?? "";
                    const n = v === "" ? null : Number(v);
                    const bad = n !== null && (Number.isNaN(n) || n < 0 || n > a.maxMarks);
                    const low = n !== null && !bad && (n / a.maxMarks) * 100 < 30;
                    return (
                      <td key={a.id} className="text-right">
                        {editable ? (
                          <input
                            inputMode="decimal"
                            className={`input input-sm w-20 text-right num ${bad ? "border-danger text-danger" : low ? "border-warn" : v === "" ? "border-danger/60" : ""}`}
                            value={v}
                            onChange={(e) => onChange(r.enrollmentId, a.id, e.target.value)}
                          />
                        ) : (
                          <span className={`num ${bad ? "text-danger" : low ? "text-warn" : v === "" ? "text-danger" : "text-ink"}`}>{v === "" ? "missing" : v}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-right num ink">{c.overall ?? "—"}</td>
                  <td className="ink">{c.grade}</td>
                  <td>
                    {c.passed === null ? (
                      <span className="pill bg-elevated-3 text-muted">incomplete</span>
                    ) : c.passed ? (
                      <span className="pill bg-[rgba(3,144,74,0.18)] text-[#39c27c]">pass</span>
                    ) : (
                      <span className="pill bg-[rgba(241,58,44,0.18)] text-[#ff6b60]">{c.componentFail && (c.overall ?? 0) >= 40 ? "component fail" : "fail"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
