import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { requireRole, can } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listTimetables, loadSessions, lecturerLimits } from "@/lib/data/timetable";
import { detectClashes, clashLabel, summariseClashes } from "@/lib/engine/clash";
import { Card, Empty, PageHeader, Pill, Stat, Status } from "@/components/ui";
import { WeekGrid } from "@/components/WeekGrid";
import { DAY_NAMES, TERMS, minToTime } from "@/lib/constants";
import { autoResolve, deleteTimetable, generateAction, publishTimetable } from "./actions";

export const dynamic = "force-dynamic";

type SP = { tt?: string; view?: string; id?: string; msg?: string; report?: string };

export default async function TimetablePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireRole("ADMIN", "RTE_STAFF", "LECTURER");
  const sp = await searchParams;
  const timetables = await listTimetables(TERMS.current);
  const current = timetables.find((t) => t.id === sp.tt) ?? timetables.find((t) => t.status === "PUBLISHED") ?? timetables[0];
  const editable = can(user.role, "timetable:edit");
  if (!current) {
    return (
      <>
        <PageHeader eyebrow={TERMS.current} title="Timetable" />
        <Empty title="No timetables yet" />
      </>
    );
  }
  const [sessions, limits, cohorts, lecturers, rooms] = await Promise.all([
    loadSessions(current.id),
    lecturerLimits(),
    prisma.cohort.findMany({ orderBy: { code: "asc" } }),
    prisma.lecturer.findMany({ orderBy: { name: "asc" } }),
    prisma.room.findMany({ orderBy: { code: "asc" } }),
  ]);
  const clashes = detectClashes(sessions, limits);
  const summary = summariseClashes(clashes);
  const clashIds = new Set(clashes.flatMap((c) => c.sessionIds));

  const view = (sp.view as "cohort" | "lecturer" | "room" | "all") ?? (user.role === "LECTURER" ? "lecturer" : "cohort");
  const defaultId = view === "cohort" ? cohorts[0]?.id : view === "lecturer" ? (user.lecturerId ?? lecturers[0]?.id) : view === "room" ? rooms[0]?.id : "";
  const id = sp.id ?? defaultId;
  const filtered = view === "all" ? sessions : sessions.filter((s) => (view === "cohort" ? s.cohortId === id : view === "lecturer" ? s.lecturerId === id : s.roomId === id));
  const totalSlots = await prisma.timeSlot.count();
  const utilisation = rooms.length && totalSlots ? sessions.length / (rooms.length * totalSlots) : 0;

  const report = sp.report ? await prisma.auditLog.findFirst({ where: { entity: "Timetable", entityId: current.id, action: "TIMETABLE_GENERATED" }, orderBy: { createdAt: "desc" } }) : null;
  const rep = report?.details ? (JSON.parse(report.details) as { placed: number; units: number; ms: number; iterations: number; repaired: number; avgRoomFill: number; unplaced: { module: string; cohort: string; type: string; reason: string }[] }) : null;


  return (
    <>
      <PageHeader
        eyebrow={`${TERMS.current} · ${current.name}`}
        title="Timetable"
        description="Weekly academic schedule with real-time detection of room double-bookings, lecturer clashes, group overlaps and capacity overflow."
        actions={
          <>
            <Status value={current.status} />
            {editable && (
              <>
                <Link href={`/timetable/session/new?tt=${current.id}`} className="btn btn-outline btn-sm">
                  + Add session
                </Link>
                <details className="relative">
                  <summary className="btn btn-primary btn-sm cursor-pointer list-none">Generate clash-free option</summary>
                  <ActionForm action={generateAction} className="absolute right-0 top-10 z-20 w-[360px] card card-pad space-y-3 text-[13px]">
                    <div className="caps">Constraint solver settings</div>
                    <input name="name" className="input input-sm" placeholder="Option name" defaultValue={`Option ${timetables.length + 1} — auto-generated`} />
                    <div className="grid grid-cols-3 gap-2">
                      <label className="text-[11px] text-muted">
                        Seed
                        <input name="seed" type="number" className="input input-sm mt-1" defaultValue={timetables.length + 7} />
                      </label>
                      <label className="text-[11px] text-muted">
                        Lecturer h/day
                        <input name="maxLecturerDaily" type="number" className="input input-sm mt-1" defaultValue={4} min={2} max={8} />
                      </label>
                      <label className="text-[11px] text-muted">
                        Group h/day
                        <input name="maxCohortDaily" type="number" className="input input-sm mt-1" defaultValue={6} min={3} max={9} />
                      </label>
                    </div>
                    <label className="flex items-center gap-2 text-[12px]">
                      <input type="checkbox" name="keepLocked" defaultChecked /> Keep locked sessions from the published timetable
                    </label>
                    <p className="text-[11px] text-muted">Places every teaching hour for all {cohorts.length} groups using hard constraints (no double-bookings, capacity, lab rooms, daily caps) and soft preferences (room fit, spread, no gaps).</p>
                    <SubmitButton className="btn btn-primary btn-sm w-full">Run solver</SubmitButton>
                  </ActionForm>
                </details>
              </>
            )}
          </>
        }
      />

      {sp.msg && <div className="mb-4 border border-hairline-2 bg-elevated px-4 py-3 text-ink text-[13px]">{sp.msg}</div>}

      {rep && (
        <Card className="mb-4" title="Generation report" subtitle={`Solver finished in ${rep.ms} ms · ${rep.iterations} search iterations · ${rep.repaired} repairs`}>
          <div className="grid md:grid-cols-4 gap-4 text-[13px]">
            <div>
              <div className="caps">Placed</div>
              <div className="text-ink text-[22px] num">
                {rep.placed}/{rep.units}
              </div>
            </div>
            <div>
              <div className="caps">Avg room fill</div>
              <div className="text-ink text-[22px] num">{Math.round(rep.avgRoomFill * 100)}%</div>
            </div>
            <div>
              <div className="caps">Hard clashes</div>
              <div className={`text-[22px] num ${summary.high ? "text-danger" : "text-success"}`}>{summary.high}</div>
            </div>
            <div>
              <div className="caps">Quality score</div>
              <div className="text-ink text-[22px] num">{current.score ?? "—"}</div>
            </div>
          </div>
          {rep.unplaced.length > 0 && (
            <ul className="mt-4 text-[12px] space-y-1">
              {rep.unplaced.map((u, i) => (
                <li key={i} className="text-warn">
                  Unplaced: {u.module} {u.type.toLowerCase()} for {u.cohort} — {u.reason}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4 mb-4">
        <Stat label="Sessions / week" value={sessions.length} hint={`${cohorts.length} groups · ${lecturers.length} lecturers`} />
        <Stat label="Hard conflicts" value={summary.high} tone={summary.high ? "danger" : "success"} hint={summary.high ? "must be resolved before publishing" : "publishable"} />
        <Stat label="Soft warnings" value={summary.total - summary.high} tone={summary.total - summary.high ? "warn" : "success"} hint="overload / room type" />
        <Stat label="Room utilisation" value={`${Math.round(utilisation * 100)}%`} hint="of all room-slots" />
        <Stat label="Quality score" value={current.score ?? "—"} hint="coverage × room fit − clashes" />
      </div>

      <div className="grid xl:grid-cols-[1fr_360px] gap-4">
        <Card
          pad={false}
          title="Weekly grid"
          subtitle={`${filtered.length} sessions shown · ${view} view`}
          actions={
            <form method="get" className="flex items-center gap-2">
              <input type="hidden" name="tt" value={current.id} />
              <select name="view" defaultValue={view} className="input input-sm w-32">
                <option value="cohort">By group</option>
                <option value="lecturer">By lecturer</option>
                <option value="room">By room</option>
                <option value="all">Everything</option>
              </select>
              <select name="id" defaultValue={id} className="input input-sm w-48">
                {view === "cohort" && cohorts.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.size} students</option>)}
                {view === "lecturer" && lecturers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                {view === "room" && rooms.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.capacity}</option>)}
                {view === "all" && <option value="">All sessions</option>}
              </select>
              <button className="btn btn-outline btn-sm">Show</button>
            </form>
          }
        >
          <WeekGrid sessions={filtered} mode={view} clashIds={clashIds} linkBase={editable && current.status !== "PUBLISHED" ? `/timetable/session/` : editable ? `/timetable/session/` : undefined} />
          <div className="flex flex-wrap items-center gap-4 px-4 py-3 text-[11px] text-muted border-t border-hairline">
            <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 border-l-2 border-info bg-elevated-2" /> Lecture</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 border-l-2 border-success bg-elevated-2" /> Tutorial</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 border-l-2 border-warn bg-elevated-2" /> Lab</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 border-l-2 border-rosso bg-[rgba(218,41,28,0.18)]" /> In conflict</span>
            {editable && <span className="ml-auto">Click a session to edit or move it.</span>}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Timetable versions" pad={false}>
            <ul>
              {timetables.map((t) => (
                <li key={t.id} className={`px-5 py-3 border-b border-hairline last:border-b-0 ${t.id === current.id ? "bg-elevated-2" : ""}`}>
                  <Link href={`/timetable?tt=${t.id}`} className="text-ink text-[13px] hover:underline block">
                    {t.name}
                  </Link>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-muted">
                    <Status value={t.status} />
                    <span>{t._count.sessions} sessions</span>
                    {t.score !== null && <span>· score {t.score}</span>}
                  </div>
                </li>
              ))}
            </ul>
            {editable && current.status !== "PUBLISHED" && (
              <div className="flex gap-2 p-4 border-t border-hairline">
                <ActionForm action={publishTimetable}>
                  <input type="hidden" name="id" value={current.id} />
                  <SubmitButton className="btn btn-primary btn-sm" disabled={summary.high > 0} title={summary.high ? "Resolve hard conflicts first" : ""}>
                    Publish this version
                  </SubmitButton>
                </ActionForm>
                {summary.high > 0 && (
                  <ActionForm action={autoResolve}>
                    <input type="hidden" name="id" value={current.id} />
                    <SubmitButton className="btn btn-outline btn-sm">Auto-resolve</SubmitButton>
                  </ActionForm>
                )}
                <ActionForm action={deleteTimetable} className="ml-auto">
                  <input type="hidden" name="id" value={current.id} />
                  <SubmitButton className="btn btn-ghost btn-sm text-danger">Delete</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Card>

          <Card title="Conflict monitor" subtitle={summary.total ? `${summary.total} issue(s) detected` : "No conflicts"} pad={false}>
            {clashes.length === 0 ? (
              <div className="p-5 text-success text-[13px]">Every room, lecturer and group is booked at most once per slot, and every room fits its group.</div>
            ) : (
              <ul className="max-h-[560px] overflow-auto">
                {clashes.map((c, i) => (
                  <li key={i} className="px-5 py-3 border-b border-hairline last:border-b-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Status value={c.severity} />
                      <span className="text-ink text-[12px] font-medium">{clashLabel(c.type)}</span>
                      {c.day !== undefined && (
                        <span className="text-[11px] text-muted ml-auto num">
                          {DAY_NAMES[c.day]} {minToTime(c.startMin!)}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-body">{c.message}</p>
                    {editable && (
                      <div className="mt-1 flex gap-2">
                        {c.sessionIds.slice(0, 3).map((sid) => (
                          <Link key={sid} href={`/timetable/session/${sid}?tt=${current.id}`} className="text-[11px] underline text-muted hover:text-ink">
                            fix →
                          </Link>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {summary.total > 0 && (
              <div className="p-4 border-t border-hairline flex flex-wrap gap-2">
                {Object.entries(summary.counts).map(([k, v]) => (
                  <Pill key={k}>
                    {clashLabel(k as never)} · {v}
                  </Pill>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
