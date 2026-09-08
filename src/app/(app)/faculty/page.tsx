import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPublishedTimetable, loadSessions } from "@/lib/data/timetable";
import { Bar, Card, PageHeader, Pill, Stat } from "@/components/ui";
import { TERMS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function FacultyPage() {
  await requireRole("ADMIN", "RTE_STAFF", "LECTURER");
  const [lecturers, tt] = await Promise.all([
    prisma.lecturer.findMany({ include: { assignments: { where: { term: TERMS.current }, include: { module: true, cohort: true } }, _count: { select: { invigilations: true } } }, orderBy: { name: "asc" } }),
    getPublishedTimetable(),
  ]);
  const sessions = tt ? await loadSessions(tt.id) : [];
  const rows = lecturers
    .map((l) => {
      const mine = sessions.filter((s) => s.lecturerId === l.id);
      const days = new Set(mine.map((s) => s.day)).size;
      const modules = [...new Set(l.assignments.map((a) => a.module.code))];
      const planned = l.assignments.reduce((a, x) => a + x.hoursPerWeek, 0);
      return { l, hours: mine.length, planned, days, modules, groups: new Set(l.assignments.map((a) => a.cohortId)).size, duties: l._count.invigilations, ratio: mine.length / l.maxHoursPerWeek };
    })
    .sort((a, b) => b.ratio - a.ratio);
  const over = rows.filter((r) => r.hours > r.l.maxHoursPerWeek).length;
  const under = rows.filter((r) => r.ratio < 0.5).length;
  const avg = rows.length ? rows.reduce((a, r) => a + r.hours, 0) / rows.length : 0;
  const byDept = new Map<string, { hours: number; n: number }>();
  for (const r of rows) {
    const d = byDept.get(r.l.department) ?? { hours: 0, n: 0 };
    d.hours += r.hours;
    d.n++;
    byDept.set(r.l.department, d);
  }

  return (
    <>
      <PageHeader eyebrow={`Workload · ${TERMS.current}`} title="Faculty workload & allocations" description="Weekly contact hours from the published timetable against each lecturer's limit, plus module assignments and invigilation duties." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Stat label="Lecturers" value={lecturers.length} hint={`${byDept.size} departments`} />
        <Stat label="Avg contact hours" value={avg.toFixed(1)} hint="per week" />
        <Stat label="Overloaded" value={over} tone={over ? "danger" : "success"} hint="above weekly limit" />
        <Stat label="Under 50% load" value={under} tone={under ? "warn" : "success"} hint="capacity available" />
      </div>
      <div className="grid xl:grid-cols-[1fr_300px] gap-4">
        <Card pad={false} title="Contact hours vs limit">
          <table className="table">
            <thead>
              <tr>
                <th>Lecturer</th>
                <th>Dept</th>
                <th className="w-64">Weekly load</th>
                <th>Days</th>
                <th>Modules</th>
                <th>Groups</th>
                <th>Duties</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.l.id}>
                  <td className="ink">
                    <Link href={`/faculty/${r.l.id}`} className="hover:underline">
                      {r.l.name}
                    </Link>
                    <div className="text-[11px] text-muted">{r.l.staffNo}</div>
                  </td>
                  <td>{r.l.department}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Bar value={r.hours} max={r.l.maxHoursPerWeek} tone={r.hours > r.l.maxHoursPerWeek ? "danger" : r.ratio > 0.85 ? "warn" : "info"} />
                      </div>
                      <span className={`num text-[12px] w-14 text-right ${r.hours > r.l.maxHoursPerWeek ? "text-danger" : "text-ink"}`}>
                        {r.hours}/{r.l.maxHoursPerWeek}h
                      </span>
                    </div>
                    {r.planned !== r.hours && <div className="text-[10px] text-warn mt-0.5">{r.planned}h assigned, {r.hours}h timetabled</div>}
                  </td>
                  <td className="num">{r.days}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {r.modules.slice(0, 4).map((m) => (
                        <Pill key={m}>{m}</Pill>
                      ))}
                      {r.modules.length > 4 && <Pill>+{r.modules.length - 4}</Pill>}
                    </div>
                  </td>
                  <td className="num">{r.groups}</td>
                  <td className="num">{r.duties}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Load by department">
          <div className="space-y-4">
            {[...byDept.entries()].map(([d, v]) => (
              <div key={d}>
                <div className="flex justify-between text-[12px] mb-1">
                  <span className="text-ink">{d}</span>
                  <span className="num text-muted">
                    {v.hours}h · {v.n} staff · avg {(v.hours / v.n).toFixed(1)}
                  </span>
                </div>
                <Bar value={v.hours / v.n} max={18} tone="info" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
