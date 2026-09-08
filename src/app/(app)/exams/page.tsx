import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { requireRole, can } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, Empty, PageHeader, Stat, Status } from "@/components/ui";
import { fmtDate, timeRange } from "@/lib/constants";
import { createExam } from "./actions";

export const dynamic = "force-dynamic";

export default async function ExamsPage({ searchParams }: { searchParams: Promise<{ msg?: string; status?: string }> }) {
  const user = await requireRole("ADMIN", "RTE_STAFF", "LECTURER");
  const sp = await searchParams;
  const editable = can(user.role, "exams:edit");
  const [exams, modules, cohorts] = await Promise.all([
    prisma.examSession.findMany({
      where: sp.status ? { status: sp.status } : {},
      include: { module: true, cohorts: { include: { cohort: true } }, venues: { include: { room: true } }, _count: { select: { seats: true, invigilations: true } } },
      orderBy: [{ date: "asc" }, { startMin: "asc" }, { module: { code: "asc" } }],
    }),
    prisma.module.findMany({ orderBy: { code: "asc" } }),
    prisma.cohort.findMany({ orderBy: { code: "asc" } }),
  ]);
  const counts: Record<string, number> = {};
  for (const e of exams) counts[e.status] = (counts[e.status] ?? 0) + 1;
  const sittings = new Map<string, typeof exams>();
  for (const e of exams) {
    const k = `${e.date}|${e.startMin}`;
    sittings.set(k, [...(sittings.get(k) ?? []), e]);
  }

  return (
    <>
      <PageHeader
        eyebrow="Examination planning"
        title="Examination sessions"
        description="Each sitting groups every paper held at the same time. Venues, seating and invigilators are allocated per sitting so shared halls interleave papers automatically."
        actions={
          editable ? (
            <details className="relative">
              <summary className="btn btn-primary btn-sm cursor-pointer list-none">+ Schedule exam</summary>
              <ActionForm action={createExam} className="absolute right-0 top-10 z-20 w-[420px] card card-pad space-y-3 text-[13px]">
                <label className="block">
                  <span className="caps block mb-1">Module</span>
                  <select name="moduleId" className="input input-sm">
                    {modules.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.code} — {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block col-span-1">
                    <span className="caps block mb-1">Date</span>
                    <input type="date" name="date" className="input input-sm" defaultValue="2026-12-16" required />
                  </label>
                  <label className="block">
                    <span className="caps block mb-1">Start</span>
                    <select name="startMin" className="input input-sm" defaultValue={540}>
                      {[540, 600, 660, 780, 840, 900].map((m) => (
                        <option key={m} value={m}>
                          {String(Math.floor(m / 60)).padStart(2, "0")}:{String(m % 60).padStart(2, "0")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="caps block mb-1">Minutes</span>
                    <input type="number" name="duration" className="input input-sm" defaultValue={120} min={30} step={15} />
                  </label>
                </div>
                <div>
                  <span className="caps block mb-1">Student groups</span>
                  <div className="grid grid-cols-4 gap-1 max-h-32 overflow-auto">
                    {cohorts.map((c) => (
                      <label key={c.id} className="flex items-center gap-1 text-[12px]">
                        <input type="checkbox" name="cohortIds" value={c.id} /> {c.code}
                      </label>
                    ))}
                  </div>
                </div>
                <SubmitButton className="btn btn-primary btn-sm w-full">Create</SubmitButton>
              </ActionForm>
            </details>
          ) : null
        }
      />
      {sp.msg && <div className="mb-4 border border-hairline-2 bg-elevated px-4 py-3 text-ink text-[13px]">{sp.msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
        <Stat label="Exams" value={exams.length} hint={`${sittings.size} sittings`} href="/exams" />
        <Stat label="Planned" value={counts.PLANNED ?? 0} tone="warn" hint="no venues yet" href="/exams?status=PLANNED" />
        <Stat label="Seated" value={(counts.SEATED ?? 0) + (counts.VENUES_ALLOCATED ?? 0)} tone="info" hint="venues / seats done" href="/exams?status=SEATED" />
        <Stat label="Ready" value={counts.READY ?? 0} tone="success" hint="invigilators assigned" href="/exams?status=READY" />
        <Stat label="Seat lookup" value="🔍" hint="find any student's seat" href="/exams/seats" />
      </div>

      {exams.length === 0 ? (
        <Card>
          <Empty title="No examinations scheduled" />
        </Card>
      ) : (
        <div className="space-y-4">
          {[...sittings.entries()].map(([k, list]) => (
            <Card key={k} pad={false} title={`${fmtDate(list[0].date)} · ${timeRange(list[0].startMin, list[0].endMin)}`} subtitle={`${list.length} paper(s) in this sitting`}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Module</th>
                    <th>Groups</th>
                    <th>Venues</th>
                    <th>Seated</th>
                    <th>Invigilators</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((e) => (
                    <tr key={e.id}>
                      <td className="ink">
                        <Link href={`/exams/${e.id}`} className="hover:underline">
                          {e.module.code}
                        </Link>{" "}
                        <span className="text-muted">{e.module.name}</span>
                      </td>
                      <td>{e.cohorts.map((c) => c.cohort.code).join(", ")}</td>
                      <td>{e.venues.map((v) => v.room.code).join(", ") || <span className="text-muted">—</span>}</td>
                      <td className="num">{e._count.seats}</td>
                      <td className="num">{e._count.invigilations}</td>
                      <td>
                        <Status value={e.status} />
                      </td>
                      <td className="text-right">
                        <Link href={`/exams/${e.id}`} className="btn btn-ghost btn-sm">
                          Open →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
