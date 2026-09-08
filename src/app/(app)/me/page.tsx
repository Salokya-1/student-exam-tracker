import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { studentRecord } from "@/lib/data/results";
import { getPublishedTimetable, loadSessions } from "@/lib/data/timetable";
import { Card, KV, PageHeader, Pill, Stat, Status } from "@/components/ui";
import { WeekGrid } from "@/components/WeekGrid";
import { TERMS, fmtDate, timeRange } from "@/lib/constants";
import { classification } from "@/lib/engine/grading";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const user = await requireUser();
  if (user.role === "STUDENT" && user.studentId) return <StudentPortal studentId={user.studentId} />;
  if (user.role === "LECTURER" && user.lecturerId) redirect(`/faculty/${user.lecturerId}`);
  redirect("/dashboard");
}

async function StudentPortal({ studentId }: { studentId: string }) {
  const student = await prisma.student.findUniqueOrThrow({
    where: { id: studentId },
    include: { cohort: true, intake: { include: { programme: true } }, seats: { include: { exam: { include: { module: true } }, room: true }, orderBy: { exam: { date: "asc" } } }, progressions: { orderBy: { term: "desc" }, take: 1 } },
  });
  const record = (await studentRecord(studentId)).filter((r) => r.sheetStatus === "PUBLISHED");
  const avg = record.length ? record.reduce((a, r) => a + (r.result.overall ?? 0), 0) / record.length : null;
  const tt = await getPublishedTimetable();
  const sessions = tt ? (await loadSessions(tt.id)).filter((s) => s.cohortId === student.cohortId) : [];
  const now = new Date().getDay();
  const today = sessions.filter((s) => s.day === now).sort((a, b) => a.startMin - b.startMin);
  const nextExam = student.seats[0];
  const current = await prisma.moduleEnrollment.findMany({ where: { studentId, term: TERMS.current }, include: { module: true } });

  return (
    <>
      <PageHeader eyebrow={`${student.intake.programme.name} · ${student.cohort.code} · Semester ${student.semester}`} title={`Welcome, ${student.firstName}`} description={`Student no. ${student.studentNo}. Your personal timetable, exam seats and published results in one place.`} actions={<Status value={student.standing} />} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Classes this week" value={sessions.length} hint={`${today.length} today`} />
        <Stat label="Published average" value={avg !== null ? avg.toFixed(1) : "—"} hint={avg !== null ? classification(avg) : "no results yet"} />
        <Stat label="Next exam" value={nextExam ? nextExam.exam.module.code : "—"} tone="info" hint={nextExam ? `${fmtDate(nextExam.exam.date)} · seat ${nextExam.label} in ${nextExam.room.code}` : "no seats allocated"} />
        <Stat label="Last progression" value={student.progressions[0]?.decision.replace(/_/g, " ") ?? "—"} hint={student.progressions[0]?.note} />
      </div>
      <div className="grid xl:grid-cols-3 gap-4 mt-4">
        <Card title="Today" subtitle={today.length ? `${today.length} session(s)` : "No classes today"} pad={false}>
          <ul>
            {today.map((s) => (
              <li key={s.id} className="px-5 py-3 border-b border-hairline last:border-b-0 flex items-center justify-between">
                <div>
                  <div className="text-ink text-[13px]">
                    {s.moduleCode} <span className="text-muted">{s.moduleName}</span>
                  </div>
                  <div className="text-[11px] text-muted">
                    {s.sessionType} · {s.lecturerName}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-ink num text-[13px]">{timeRange(s.startMin, s.endMin)}</div>
                  <div className="text-[11px] text-muted">{s.roomCode}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="My exam seats" pad={false}>
          <table className="table">
            <tbody>
              {student.seats.map((s) => (
                <tr key={s.id}>
                  <td className="ink">
                    {s.exam.module.code}
                    <div className="text-[11px] text-muted">
                      {fmtDate(s.exam.date)} · {timeRange(s.exam.startMin, s.exam.endMin)}
                    </div>
                  </td>
                  <td>
                    {s.room.code}
                    <div className="text-[11px] text-muted">{s.room.name}</div>
                  </td>
                  <td className="text-right">
                    <Pill tone="rosso">{s.label}</Pill>
                  </td>
                </tr>
              ))}
              {!student.seats.length && (
                <tr>
                  <td className="text-muted">Seats will appear once the RTE Department generates the seating plan.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <Card title="Current modules" subtitle={TERMS.current}>
          {current.map((e) => (
            <KV key={e.id} k={e.module.code} v={e.module.name} />
          ))}
          <Link href={`/students/${studentId}`} className="btn btn-outline btn-sm mt-4">
            Full academic record
          </Link>
        </Card>
      </div>
      <Card title="My weekly timetable" subtitle={tt?.name} className="mt-4" pad={false}>
        <WeekGrid sessions={sessions} mode="cohort" />
      </Card>
      <Card title="Published results" className="mt-4" pad={false}>
        <table className="table">
          <thead>
            <tr>
              <th>Term</th>
              <th>Module</th>
              <th>Overall</th>
              <th>Grade</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {record.map((r) => (
              <tr key={r.enrolment.id}>
                <td>{r.enrolment.term}</td>
                <td className="ink">
                  {r.enrolment.module.code} <span className="text-muted">{r.enrolment.module.name}</span>
                </td>
                <td className="num ink">{r.result.overall ?? "—"}</td>
                <td className="ink">{r.result.grade}</td>
                <td>
                  <Status value={r.enrolment.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
