import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { requireRole, can } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPublishedTimetable, loadSessions } from "@/lib/data/timetable";
import { Card, KV, PageHeader, Status } from "@/components/ui";
import { BackLink } from "@/components/Shell";
import { WeekGrid } from "@/components/WeekGrid";
import { DAY_NAMES, TERMS, fmtDate, timeRange } from "@/lib/constants";
import { reassignLecturer } from "../actions";

export const dynamic = "force-dynamic";

export default async function LecturerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const user = await requireRole("ADMIN", "RTE_STAFF", "LECTURER");
  const { id } = await params;
  const { msg } = await searchParams;
  const l = await prisma.lecturer.findUnique({
    where: { id },
    include: {
      assignments: { where: { term: TERMS.current }, include: { module: true, cohort: true } },
      invigilations: { include: { exam: { include: { module: true } }, room: true }, orderBy: { exam: { date: "asc" } } },
    },
  });
  if (!l) notFound();
  const tt = await getPublishedTimetable();
  const sessions = tt ? (await loadSessions(tt.id)).filter((s) => s.lecturerId === id) : [];
  const perDay = [0, 1, 2, 3, 4, 5].map((d) => sessions.filter((s) => s.day === d).length);
  const lecturers = await prisma.lecturer.findMany({ where: { department: l.department }, orderBy: { name: "asc" } });
  const editable = can(user.role, "timetable:edit");

  return (
    <>
      <BackLink href="/faculty">Faculty</BackLink>
      <PageHeader eyebrow={`${l.department} · ${l.staffNo}`} title={l.name} description={l.email} actions={sessions.length > l.maxHoursPerWeek ? <Status value="HIGH" /> : <Status value="GOOD" />} />
      {msg && <div className="mb-4 border border-hairline-2 bg-elevated px-4 py-3 text-ink text-[13px]">{msg}</div>}
      <div className="grid xl:grid-cols-4 gap-4">
        <Card title="Workload">
          <KV k="Contact hours" v={`${sessions.length} / ${l.maxHoursPerWeek} per week`} />
          <KV k="Teaching days" v={new Set(sessions.map((s) => s.day)).size} />
          <KV k="Busiest day" v={DAY_NAMES[perDay.indexOf(Math.max(...perDay))]} />
          <KV k="Modules" v={new Set(l.assignments.map((a) => a.moduleId)).size} />
          <KV k="Groups" v={new Set(l.assignments.map((a) => a.cohortId)).size} />
          <KV k="Invigilation duties" v={l.invigilations.length} />
        </Card>
        <Card title="Teaching allocations" subtitle={editable ? "Reassign to balance workload — timetable sessions follow" : undefined} className="xl:col-span-3" pad={false}>
          <table className="table">
            <thead>
              <tr>
                <th>Module</th>
                <th>Group</th>
                <th>Type</th>
                <th>h/week</th>
                {editable && <th>Reassign to</th>}
              </tr>
            </thead>
            <tbody>
              {l.assignments.map((a) => (
                <tr key={a.id}>
                  <td className="ink">
                    {a.module.code} <span className="text-muted">{a.module.name}</span>
                  </td>
                  <td>{a.cohort.code}</td>
                  <td>{a.sessionType}</td>
                  <td className="num">{a.hoursPerWeek}</td>
                  {editable && (
                    <td>
                      <ActionForm action={reassignLecturer} className="flex gap-2">
                        <input type="hidden" name="assignmentId" value={a.id} />
                        <select name="lecturerId" className="input input-sm w-48" defaultValue={l.id}>
                          {lecturers.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                        <SubmitButton className="btn btn-outline btn-sm">Move</SubmitButton>
                      </ActionForm>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Card title="Weekly timetable" subtitle={tt?.name} className="mt-4" pad={false}>
        <WeekGrid sessions={sessions} mode="lecturer" />
      </Card>
      <Card title="Invigilation roster" className="mt-4" pad={false}>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Exam</th>
              <th>Room</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {l.invigilations.map((i) => (
              <tr key={i.id}>
                <td className="ink whitespace-nowrap">
                  {fmtDate(i.exam.date)} <span className="text-muted">{timeRange(i.exam.startMin, i.exam.endMin)}</span>
                </td>
                <td>
                  <Link href={`/exams/${i.examId}`} className="hover:underline text-ink">
                    {i.exam.module.code}
                  </Link>{" "}
                  <span className="text-muted">{i.exam.module.name}</span>
                </td>
                <td>{i.room.code}</td>
                <td>
                  <Status value={i.role} />
                </td>
              </tr>
            ))}
            {!l.invigilations.length && (
              <tr>
                <td colSpan={4} className="text-muted">
                  No duties assigned.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
