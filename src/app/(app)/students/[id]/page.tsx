import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { studentRecord } from "@/lib/data/results";
import { getPublishedTimetable, loadSessions } from "@/lib/data/timetable";
import { Card, KV, PageHeader, Pill, Status } from "@/components/ui";
import { BackLink } from "@/components/Shell";
import { DAY_NAMES, fmtDate, timeRange } from "@/lib/constants";
import { classification, riskScore } from "@/lib/engine/grading";
import { WeekGrid } from "@/components/WeekGrid";

export const dynamic = "force-dynamic";

export default async function StudentProfile({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (user.role === "STUDENT" && user.studentId !== id) notFound();
  const student = await prisma.student.findUnique({
    where: { id },
    include: { cohort: true, intake: { include: { programme: true } }, progressions: { orderBy: { term: "asc" } }, seats: { include: { exam: { include: { module: true } }, room: true }, orderBy: { exam: { date: "asc" } } } },
  });
  if (!student) notFound();
  const staff = user.role !== "STUDENT";
  const record = await studentRecord(id);
  const visible = record.filter((r) => staff || r.sheetStatus === "PUBLISHED");
  const terms = [...new Set(visible.map((r) => r.enrolment.term))];
  const published = record.filter((r) => r.sheetStatus === "PUBLISHED" && r.result.overall !== null);
  const avg = published.length ? published.reduce((a, r) => a + r.result.overall!, 0) / published.length : null;
  const fails = record.filter((r) => r.enrolment.status === "FAILED").length;
  const resits = record.reduce((a, r) => a + r.enrolment.resits.length, 0);
  const last = student.progressions[student.progressions.length - 1];
  const prev = student.progressions[student.progressions.length - 2];
  const risk = riskScore({ average: avg, fails, resits, trend: last && prev ? last.average - prev.average : null, incomplete: 0 });
  const creditsEarned = record.filter((r) => r.result.passed && r.sheetStatus === "PUBLISHED").reduce((a, r) => a + r.enrolment.module.credits, 0);

  const tt = await getPublishedTimetable();
  const sessions = tt ? (await loadSessions(tt.id)).filter((s) => s.cohortId === student.cohortId) : [];

  return (
    <>
      <BackLink href={staff ? "/students" : "/me"}>{staff ? "Student directory" : "My portal"}</BackLink>
      <PageHeader
        eyebrow={`${student.intake.programme.name} · ${student.cohort.code}`}
        title={`${student.firstName} ${student.lastName}`}
        description={`Student no. ${student.studentNo} · ${student.email}`}
        actions={<Status value={student.standing} />}
      />

      <div className="grid xl:grid-cols-4 gap-4">
        <Card title="Profile">
          <KV k="Programme" v={student.intake.programme.code} />
          <KV k="Intake" v={student.intake.code} />
          <KV k="Group" v={student.cohort.code} />
          <KV k="Semester" v={student.semester} />
          <KV k="Credits earned" v={creditsEarned} />
          <KV k="Published average" v={avg !== null ? `${avg.toFixed(1)} · ${classification(avg)}` : "—"} />
          {staff && <KV k="Risk score" v={<Pill tone={risk >= 60 ? "danger" : risk >= 30 ? "warn" : "success"}>{risk}</Pill>} />}
        </Card>

        <Card title="Academic record" subtitle={staff ? "All sheets incl. unpublished (staff view)" : "Published results only"} className="xl:col-span-3" pad={false}>
          {terms.map((t) => (
            <div key={t}>
              <div className="px-6 py-2 caps bg-elevated-2 border-y border-hairline">{t}</div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Module</th>
                    <th>Credits</th>
                    {staff && <th>Sheet</th>}
                    <th>Components</th>
                    <th>Overall</th>
                    <th>Grade</th>
                    <th>Outcome</th>
                    <th>Resit</th>
                  </tr>
                </thead>
                <tbody>
                  {visible
                    .filter((r) => r.enrolment.term === t)
                    .map((r) => (
                      <tr key={r.enrolment.id}>
                        <td className="ink">
                          {r.enrolment.module.code} <span className="text-muted">{r.enrolment.module.name}</span>
                          {r.enrolment.attempt > 1 && <Pill className="ml-2">attempt {r.enrolment.attempt}</Pill>}
                        </td>
                        <td className="num">{r.enrolment.module.credits}</td>
                        {staff && (
                          <td>
                            {r.sheetId ? (
                              <Link href={`/results/${r.sheetId}`}>
                                <Status value={r.sheetStatus} />
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                        )}
                        <td className="num text-[12px]">
                          {r.assessments.map((a) => (
                            <span key={a.id} className="mr-3">
                              {a.name.slice(0, 2).toUpperCase()} {r.marks[a.id] ?? "–"}
                            </span>
                          ))}
                        </td>
                        <td className="num ink">{r.result.overall ?? "—"}</td>
                        <td className="ink">{r.result.grade}</td>
                        <td>
                          <Status value={r.enrolment.status} />
                        </td>
                        <td>{r.enrolment.resits.map((x) => <Status key={x.id} value={x.outcome} />)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mt-4">
        <Card title="Progression history" pad={false}>
          <table className="table">
            <thead>
              <tr>
                <th>Term</th>
                <th>Avg</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {student.progressions.map((p) => (
                <tr key={p.id}>
                  <td className="ink">{p.term}</td>
                  <td className="num">{p.average}</td>
                  <td>
                    <Status value={p.decision} />
                    <div className="text-[11px] text-muted mt-0.5">{p.note}</div>
                  </td>
                </tr>
              ))}
              {!student.progressions.length && (
                <tr>
                  <td colSpan={3} className="text-muted">
                    First term — no progression decision yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <Card title="Examination seats" subtitle="Allocated by the seating engine" pad={false} className="xl:col-span-2">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Module</th>
                <th>Venue</th>
                <th>Seat</th>
              </tr>
            </thead>
            <tbody>
              {student.seats.map((s) => (
                <tr key={s.id}>
                  <td className="ink whitespace-nowrap">
                    {fmtDate(s.exam.date)} <span className="text-muted">{timeRange(s.exam.startMin, s.exam.endMin)}</span>
                  </td>
                  <td>
                    {s.exam.module.code} <span className="text-muted">{s.exam.module.name}</span>
                  </td>
                  <td>
                    {s.room.code} · {s.room.name}
                  </td>
                  <td>
                    <Pill tone="rosso">{s.label}</Pill> <span className="text-muted text-[11px]">#{s.seatNo}</span>
                  </td>
                </tr>
              ))}
              {!student.seats.length && (
                <tr>
                  <td colSpan={4} className="text-muted">
                    No seats allocated yet — seating is generated closer to the exam period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title={`Weekly timetable · ${student.cohort.code}`} subtitle={tt ? tt.name : "No published timetable"} className="mt-4" pad={false}>
        <WeekGrid sessions={sessions} mode="cohort" />
      </Card>
      <p className="text-[11px] text-muted mt-2">
        Days shown {DAY_NAMES[0]}–{DAY_NAMES[5]}; times are 60-minute teaching slots.
      </p>
    </>
  );
}
