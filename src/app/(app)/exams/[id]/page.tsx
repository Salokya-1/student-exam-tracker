import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { requireRole, can } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, KV, PageHeader, Pill, Status } from "@/components/ui";
import { BackLink } from "@/components/Shell";
import { SeatMap } from "@/components/SeatMap";
import { fmtDate, timeRange } from "@/lib/constants";
import { requiredInvigilators } from "@/lib/engine/invigilation";
import { allocateVenues, assignInvigilatorsAction, deleteExam, generateSeatingAction, setExamStatus } from "../actions";
import { examCandidates } from "@/lib/services/exams";

export const dynamic = "force-dynamic";

export default async function ExamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const user = await requireRole("ADMIN", "RTE_STAFF", "LECTURER");
  const { id } = await params;
  const { msg } = await searchParams;
  const editable = can(user.role, "exams:edit");
  const exam = await prisma.examSession.findUnique({
    where: { id },
    include: {
      module: true,
      cohorts: { include: { cohort: true } },
      venues: { include: { room: true } },
      seats: { include: { student: { include: { cohort: true } }, room: true }, orderBy: [{ roomId: "asc" }, { seatNo: "asc" }] },
      invigilations: { include: { lecturer: true, room: true } },
    },
  });
  if (!exam) notFound();
  const { students } = await examCandidates(id);
  const sitting = await prisma.examSession.findMany({ where: { date: exam.date, startMin: exam.startMin }, include: { module: true, venues: { include: { room: true } }, _count: { select: { seats: true } } } });
  const others = sitting.filter((e) => e.id !== id);
  const rooms = await prisma.room.findMany({ where: { active: true, type: { in: ["HALL", "LECTURE", "LAB"] } }, orderBy: [{ capacity: "desc" }] });
  const busyRooms = new Set((await prisma.examVenue.findMany({ where: { exam: { date: exam.date, startMin: exam.startMin, NOT: { id } } }, select: { roomId: true } })).map((v) => v.roomId));
  const venueIds = new Set(exam.venues.map((v) => v.roomId));
  // all seats in this sitting's venues (to draw shared halls with every paper)
  const allSeats = await prisma.seatAllocation.findMany({ where: { examId: { in: sitting.map((e) => e.id) }, roomId: { in: [...venueIds] } }, include: { student: { include: { cohort: true } }, exam: { include: { module: true } } } });
  const capacity = exam.venues.reduce((a, v) => a + Math.min(v.room.capacity, v.room.rows * v.room.cols), 0);
  const invigNeeded = exam.venues.reduce((a, v) => a + requiredInvigilators(allSeats.filter((s) => s.roomId === v.roomId).length), 0);

  return (
    <>
      <BackLink href="/exams">Examinations</BackLink>
      <PageHeader
        eyebrow={`${fmtDate(exam.date)} · ${timeRange(exam.startMin, exam.endMin)} · ${exam.term}`}
        title={`${exam.module.code} — ${exam.module.name}`}
        description={`${students.length} candidates from ${exam.cohorts.map((c) => c.cohort.code).join(", ")}${others.length ? ` · shares the sitting with ${others.map((o) => o.module.code).join(", ")}` : ""}`}
        actions={
          <>
            <Status value={exam.status} />
            {exam.seats.length > 0 && (
              <Link href={`/exams/${id}/print`} className="btn btn-outline btn-sm">
                Print seating plan
              </Link>
            )}
          </>
        }
      />
      {msg && <div className="mb-4 border border-hairline-2 bg-elevated px-4 py-3 text-ink text-[13px]">{msg}</div>}

      {/* workflow */}
      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <Card title="1 · Venues" subtitle={exam.venues.length ? `${exam.venues.map((v) => v.room.code).join(", ")} · capacity ${capacity}` : "No venues allocated"}>
          {editable ? (
            <div className="space-y-3">
              <ActionForm action={allocateVenues}>
                <input type="hidden" name="examId" value={id} />
                <input type="hidden" name="mode" value="auto" />
                <SubmitButton className="btn btn-primary btn-sm w-full">Auto-allocate venues</SubmitButton>
                <p className="text-[11px] text-muted mt-2">Picks the smallest free hall/room set with least wasted capacity, avoiding rooms used by other papers in this sitting.</p>
              </ActionForm>
              <details>
                <summary className="text-[12px] text-body cursor-pointer">Choose manually</summary>
                <ActionForm action={allocateVenues} className="mt-2 space-y-2">
                  <input type="hidden" name="examId" value={id} />
                  <input type="hidden" name="mode" value="manual" />
                  <div className="max-h-44 overflow-auto space-y-1">
                    {rooms.map((r) => (
                      <label key={r.id} className={`flex items-center gap-2 text-[12px] ${busyRooms.has(r.id) && !venueIds.has(r.id) ? "text-muted" : "text-ink"}`}>
                        <input type="checkbox" name="roomIds" value={r.id} defaultChecked={venueIds.has(r.id)} disabled={busyRooms.has(r.id) && !venueIds.has(r.id)} />
                        {r.code} · {r.type.toLowerCase()} · {Math.min(r.capacity, r.rows * r.cols)} seats {busyRooms.has(r.id) && !venueIds.has(r.id) && "(in use)"}
                      </label>
                    ))}
                  </div>
                  <SubmitButton className="btn btn-outline btn-sm w-full">Save venues</SubmitButton>
                </ActionForm>
              </details>
            </div>
          ) : (
            <p className="text-[12px] text-muted">RTE staff allocate venues.</p>
          )}
        </Card>
        <Card title="2 · Seating" subtitle={exam.seats.length ? `${exam.seats.length}/${students.length} seated` : "Not generated"}>
          {editable ? (
            <ActionForm action={generateSeatingAction}>
              <input type="hidden" name="examId" value={id} />
              <SubmitButton className="btn btn-primary btn-sm w-full" disabled={!exam.venues.length}>
                {exam.seats.length ? "Regenerate seating" : "Generate seating"}
              </SubmitButton>
              <p className="text-[11px] text-muted mt-2">Seats every paper in this sitting together: papers and groups interleaved so neighbours never share a paper where possible; row/seat labels assigned per venue.</p>
            </ActionForm>
          ) : (
            <p className="text-[12px] text-muted">{exam.seats.length ? "Seating plan available below." : "Awaiting RTE staff."}</p>
          )}
          <div className="mt-3 flex items-center justify-between text-[12px]">
            <span className="text-muted">Capacity used</span>
            <span className="num text-ink">
              {allSeats.length}/{capacity || "—"}
            </span>
          </div>
        </Card>
        <Card title="3 · Invigilators" subtitle={`${exam.invigilations.length} assigned · ${invigNeeded} required`}>
          {editable ? (
            <ActionForm action={assignInvigilatorsAction}>
              <input type="hidden" name="examId" value={id} />
              <SubmitButton className="btn btn-primary btn-sm w-full" disabled={!exam.seats.length}>
                {exam.invigilations.length ? "Re-assign invigilators" : "Auto-assign invigilators"}
              </SubmitButton>
              <p className="text-[11px] text-muted mt-2">One chief per room + one assistant per 25 students. Never the module&apos;s own lecturer, never double-booked, least-loaded staff first.</p>
            </ActionForm>
          ) : null}
          <ul className="mt-3 space-y-1 text-[12px]">
            {exam.invigilations.map((i) => (
              <li key={i.id} className="flex items-center justify-between">
                <span className="text-ink">{i.lecturer.name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-muted">{i.room.code}</span>
                  <Status value={i.role} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid xl:grid-cols-[300px_1fr] gap-4">
        <div className="space-y-4">
          <Card title="Details">
            <KV k="Date" v={fmtDate(exam.date)} />
            <KV k="Time" v={timeRange(exam.startMin, exam.endMin)} />
            <KV k="Duration" v={`${exam.endMin - exam.startMin} min`} />
            <KV k="Candidates" v={students.length} />
            <KV k="Groups" v={exam.cohorts.map((c) => c.cohort.code).join(", ")} />
            <KV k="Term" v={exam.term} />
            {editable && (
              <div className="flex gap-2 mt-4">
                <ActionForm action={setExamStatus}>
                  <input type="hidden" name="examId" value={id} />
                  <input type="hidden" name="status" value="COMPLETED" />
                  <SubmitButton className="btn btn-outline btn-sm">Mark completed</SubmitButton>
                </ActionForm>
                <ActionForm action={deleteExam}>
                  <input type="hidden" name="examId" value={id} />
                  <SubmitButton className="btn btn-ghost btn-sm text-danger">Delete</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Card>
          {others.length > 0 && (
            <Card title="Same sitting" subtitle="Papers sharing this date & time" pad={false}>
              <ul>
                {others.map((o) => (
                  <li key={o.id} className="px-5 py-3 border-b border-hairline last:border-b-0 text-[13px]">
                    <Link href={`/exams/${o.id}`} className="text-ink hover:underline">
                      {o.module.code}
                    </Link>
                    <div className="text-[11px] text-muted">
                      {o.venues.map((v) => v.room.code).join(", ") || "no venue"} · {o._count.seats} seated · <Status value={o.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {exam.venues.length === 0 && (
            <Card>
              <p className="text-muted text-[13px]">Allocate venues to see the seating map.</p>
            </Card>
          )}
          {exam.venues.map((v) => {
            const seats = allSeats.filter((s) => s.roomId === v.roomId);
            const papers = [...new Set(seats.map((s) => s.exam.module.code))];
            return (
              <Card key={v.id} title={`${v.room.code} · ${v.room.name}`} subtitle={`${v.room.rows} rows × ${v.room.cols} seats · ${seats.length}/${Math.min(v.room.capacity, v.room.rows * v.room.cols)} used · papers: ${papers.join(", ") || "—"}`} pad={false}>
                <SeatMap
                  rows={v.room.rows}
                  cols={v.room.cols}
                  seats={seats.map((s) => ({ row: s.row, col: s.col, label: s.label, seatNo: s.seatNo, studentNo: s.student.studentNo, name: `${s.student.firstName} ${s.student.lastName}`, cohort: s.student.cohort.code, paper: s.exam.module.code, mine: s.examId === id }))}
                />
                {seats.length > 0 && (
                  <details className="border-t border-hairline">
                    <summary className="px-5 py-3 text-[12px] cursor-pointer text-body">Seat list ({seats.length})</summary>
                    <div className="max-h-80 overflow-auto">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Seat</th>
                            <th>#</th>
                            <th>Student</th>
                            <th>Group</th>
                            <th>Paper</th>
                          </tr>
                        </thead>
                        <tbody>
                          {seats.sort((a, b) => a.seatNo - b.seatNo).map((s) => (
                            <tr key={s.id}>
                              <td>
                                <Pill tone={s.examId === id ? "rosso" : "neutral"}>{s.label}</Pill>
                              </td>
                              <td className="num">{s.seatNo}</td>
                              <td className="ink">
                                {s.student.studentNo} · {s.student.firstName} {s.student.lastName}
                              </td>
                              <td>{s.student.cohort.code}</td>
                              <td>{s.exam.module.code}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
