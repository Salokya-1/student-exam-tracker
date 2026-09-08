import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, Empty, PageHeader, Status } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = { q?: string; programme?: string; cohort?: string; standing?: string; page?: string };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireRole("ADMIN", "RTE_STAFF", "LECTURER");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page ?? 1));
  const take = 40;
  const where = {
    AND: [
      q
        ? {
            OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { studentNo: { contains: q } }, { email: { contains: q } }],
          }
        : {},
      sp.programme ? { intake: { programmeId: sp.programme } } : {},
      sp.cohort ? { cohortId: sp.cohort } : {},
      sp.standing ? { standing: sp.standing } : {},
    ],
  };
  const [students, total, programmes, cohorts] = await Promise.all([
    prisma.student.findMany({ where, include: { cohort: true, intake: { include: { programme: true } }, _count: { select: { enrolments: true } } }, orderBy: { studentNo: "asc" }, skip: (page - 1) * take, take }),
    prisma.student.count({ where }),
    prisma.programme.findMany({ orderBy: { code: "asc" } }),
    prisma.cohort.findMany({ orderBy: { code: "asc" } }),
  ]);
  const pages = Math.ceil(total / take);
  const qs = (p: number) => {
    const u = new URLSearchParams({ ...(sp as Record<string, string>), page: String(p) });
    return `/students?${u.toString()}`;
  };

  return (
    <>
      <PageHeader eyebrow="Academic records" title="Student directory" description="Search and filter every enrolled student. Open a profile for the complete academic journey: modules, results, resits, progression and exam seats." />
      <Card pad={false}>
        <form className="grid md:grid-cols-[1fr_200px_180px_160px_auto] gap-3 p-4 border-b border-hairline" method="get">
          <input name="q" defaultValue={q} className="input" placeholder="Search name, student number or email…" />
          <select name="programme" defaultValue={sp.programme ?? ""} className="input">
            <option value="">All programmes</option>
            {programmes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
          <select name="cohort" defaultValue={sp.cohort ?? ""} className="input">
            <option value="">All groups</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
          <select name="standing" defaultValue={sp.standing ?? ""} className="input">
            <option value="">Any standing</option>
            <option value="GOOD">Good</option>
            <option value="AT_RISK">At risk</option>
            <option value="PROBATION">Probation</option>
          </select>
          <button className="btn btn-outline">Filter</button>
        </form>
        {students.length === 0 ? (
          <Empty title="No students match" body="Try a broader search." />
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Student no.</th>
                  <th>Name</th>
                  <th>Programme</th>
                  <th>Group</th>
                  <th>Intake</th>
                  <th>Sem</th>
                  <th>Modules</th>
                  <th>Standing</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <td className="num">
                      <Link href={`/students/${s.id}`} className="text-ink hover:underline">
                        {s.studentNo}
                      </Link>
                    </td>
                    <td className="ink">
                      {s.firstName} {s.lastName}
                      <div className="text-[11px] text-muted">{s.email}</div>
                    </td>
                    <td>{s.intake.programme.code}</td>
                    <td>{s.cohort.code}</td>
                    <td>{s.intake.code.slice(0, 8)}</td>
                    <td className="num">{s.semester}</td>
                    <td className="num">{s._count.enrolments}</td>
                    <td>
                      <Status value={s.standing} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-t border-hairline text-[12px] text-muted">
          <span>
            {total} students · page {page} of {Math.max(1, pages)}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link className="btn btn-ghost btn-sm" href={qs(page - 1)}>
                ← Prev
              </Link>
            )}
            {page < pages && (
              <Link className="btn btn-ghost btn-sm" href={qs(page + 1)}>
                Next →
              </Link>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
