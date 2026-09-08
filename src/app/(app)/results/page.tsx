import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, Empty, PageHeader, Status, Bar } from "@/components/ui";
import { TERMS } from "@/lib/constants";

export const dynamic = "force-dynamic";
const ALL_TERMS = ["2024-AUT", "2025-SPR", "2025-AUT", "2026-SPR", "2026-AUT"];

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ term?: string; status?: string; q?: string }> }) {
  const user = await requireRole("ADMIN", "RTE_STAFF", "LECTURER");
  const sp = await searchParams;
  const term = sp.term ?? TERMS.processing;
  const lecturerModules = user.role === "LECTURER" && user.lecturerId ? (await prisma.teachingAssignment.findMany({ where: { lecturerId: user.lecturerId }, select: { moduleId: true } })).map((a) => a.moduleId) : null;
  const where = {
    term,
    ...(sp.status ? { status: sp.status } : {}),
    ...(lecturerModules ? { moduleId: { in: lecturerModules } } : {}),
    ...(sp.q ? { OR: [{ module: { code: { contains: sp.q } } }, { module: { name: { contains: sp.q } } }, { cohort: { code: { contains: sp.q } } }] } : {}),
  };
  const sheets = await prisma.resultSheet.findMany({
    where,
    include: { module: true, cohort: true, marks: { select: { marks: true } } },
    orderBy: [{ status: "asc" }, { module: { code: "asc" } }, { cohort: { code: "asc" } }],
  });
  const counts = { DRAFT: 0, SUBMITTED: 0, APPROVED: 0, PUBLISHED: 0 } as Record<string, number>;
  const all = await prisma.resultSheet.groupBy({ by: ["status"], where: { term, ...(lecturerModules ? { moduleId: { in: lecturerModules } } : {}) }, _count: { _all: true } });
  for (const a of all) counts[a.status] = a._count._all;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        eyebrow="Result processing"
        title="Result sheets"
        description="One sheet per module and group. Marks flow Draft → Submitted → Approved → Published; every step is validated and recorded in the audit trail."
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {(["DRAFT", "SUBMITTED", "APPROVED", "PUBLISHED"] as const).map((s) => (
          <Link key={s} href={`/results?term=${term}&status=${s}`} className="block">
            <div className="card card-pad">
              <div className="flex items-center justify-between">
                <Status value={s} />
                <span className="text-[28px] text-ink num">{counts[s]}</span>
              </div>
              <div className="mt-3">
                <Bar value={counts[s]} max={total} tone={s === "PUBLISHED" ? "success" : s === "APPROVED" ? "warn" : s === "SUBMITTED" ? "info" : "rosso"} />
              </div>
            </div>
          </Link>
        ))}
      </div>
      <Card pad={false}>
        <form className="grid md:grid-cols-[1fr_180px_180px_auto] gap-3 p-4 border-b border-hairline" method="get">
          <input name="q" defaultValue={sp.q ?? ""} className="input" placeholder="Search module or group…" />
          <select name="term" defaultValue={term} className="input">
            {ALL_TERMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={sp.status ?? ""} className="input">
            <option value="">Any status</option>
            {["DRAFT", "SUBMITTED", "APPROVED", "PUBLISHED"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button className="btn btn-outline">Filter</button>
        </form>
        {sheets.length === 0 ? (
          <Empty title="No sheets" body="Nothing matches these filters." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Module</th>
                <th>Group</th>
                <th>Term</th>
                <th>Completeness</th>
                <th>Status</th>
                <th>Last update</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((s) => {
                const filled = s.marks.filter((m) => m.marks !== null).length;
                const pct = s.marks.length ? Math.round((filled / s.marks.length) * 100) : 0;
                return (
                  <tr key={s.id}>
                    <td className="ink">
                      <Link href={`/results/${s.id}`} className="hover:underline">
                        {s.module.code}
                      </Link>{" "}
                      <span className="text-muted">{s.module.name}</span>
                    </td>
                    <td>{s.cohort.code}</td>
                    <td>{s.term}</td>
                    <td className="w-48">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Bar value={pct} tone={pct === 100 ? "success" : "warn"} />
                        </div>
                        <span className="num text-[11px] w-10 text-right">{pct}%</span>
                      </div>
                    </td>
                    <td>
                      <Status value={s.status} />
                    </td>
                    <td className="text-[12px]">{s.updatedAt.toLocaleDateString("en-GB")}</td>
                    <td>
                      <Link href={`/results/${s.id}`} className="btn btn-ghost btn-sm">
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
