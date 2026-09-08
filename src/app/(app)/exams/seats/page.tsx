import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, Empty, PageHeader, Pill } from "@/components/ui";
import { BackLink } from "@/components/Shell";
import { fmtDate, timeRange } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function SeatLookup({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole("ADMIN", "RTE_STAFF", "LECTURER");
  const { q } = await searchParams;
  const seats = q
    ? await prisma.seatAllocation.findMany({
        where: { OR: [{ student: { studentNo: { contains: q } } }, { student: { firstName: { contains: q } } }, { student: { lastName: { contains: q } } }, { room: { code: { contains: q } } }, { exam: { module: { code: { contains: q } } } }] },
        include: { student: { include: { cohort: true } }, room: true, exam: { include: { module: true } } },
        orderBy: [{ exam: { date: "asc" } }, { roomId: "asc" }, { seatNo: "asc" }],
        take: 200,
      })
    : [];
  return (
    <>
      <BackLink href="/exams">Examinations</BackLink>
      <PageHeader eyebrow="Student & staff lookup" title="Seat lookup" description="Find where any student sits, or list every candidate in a venue or paper." />
      <Card pad={false}>
        <form className="flex gap-3 p-4 border-b border-hairline" method="get">
          <input name="q" defaultValue={q ?? ""} className="input" placeholder="Student number, name, room code (e.g. KH-01) or module code" autoFocus />
          <button className="btn btn-primary">Search</button>
        </form>
        {!q ? (
          <Empty title="Type to search" />
        ) : seats.length === 0 ? (
          <Empty title="No seats found" body="Seating may not be generated yet for that exam." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Group</th>
                <th>Exam</th>
                <th>Date</th>
                <th>Venue</th>
                <th>Seat</th>
              </tr>
            </thead>
            <tbody>
              {seats.map((s) => (
                <tr key={s.id}>
                  <td className="ink">
                    <Link href={`/students/${s.studentId}`} className="hover:underline">
                      {s.student.studentNo} · {s.student.firstName} {s.student.lastName}
                    </Link>
                  </td>
                  <td>{s.student.cohort.code}</td>
                  <td>
                    <Link href={`/exams/${s.examId}`} className="hover:underline text-ink">
                      {s.exam.module.code}
                    </Link>{" "}
                    <span className="text-muted">{s.exam.module.name}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    {fmtDate(s.exam.date)} <span className="text-muted">{timeRange(s.exam.startMin, s.exam.endMin)}</span>
                  </td>
                  <td>
                    {s.room.code} · {s.room.name}
                  </td>
                  <td>
                    <Pill tone="rosso">{s.label}</Pill> <span className="text-muted text-[11px]">#{s.seatNo}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
