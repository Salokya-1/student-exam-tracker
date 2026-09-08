import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { dashboardData, atRiskStudents } from "@/lib/data/analytics";
import { Bar, Card, PageHeader, Pill, Stat, Status } from "@/components/ui";
import { DAY_NAMES, TERMS, fmtDate, timeRange } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requireRole("ADMIN", "RTE_STAFF", "LECTURER");
  const [d, risk] = await Promise.all([dashboardData(), atRiskStudents(8)]);
  const processed = d.sheets.counts.APPROVED + d.sheets.counts.PUBLISHED;
  const maxDay = Math.max(1, ...d.perDay.map((x) => x.sessions));

  return (
    <>
      <PageHeader
        eyebrow={`Leadership overview · ${TERMS.current}`}
        title="Operations dashboard"
        description="Live view of academic records, result processing, timetable health, examination readiness and resource utilisation."
      />

      <div className="grid grid-cols-2 xl:grid-cols-6 gap-4">
        <Stat label="Students" value={d.counts.students} hint={`${d.counts.cohorts} cohorts across 4 programmes`} href="/students" />
        <Stat label="At-risk students" value={d.counts.atRisk} tone={d.counts.atRisk ? "warn" : "success"} hint="flagged by progression rules" href="/students?standing=AT_RISK" />
        <Stat
          label={`Results processed · ${TERMS.processing}`}
          value={`${d.sheets.total ? Math.round((processed / d.sheets.total) * 100) : 0}%`}
          tone="info"
          hint={`${d.sheets.counts.PUBLISHED} published · ${d.sheets.counts.SUBMITTED} awaiting approval`}
          href="/results"
        />
        <Stat
          label="Timetable clashes"
          value={d.clashes.published}
          tone={d.clashes.published ? "danger" : "success"}
          hint={d.clashes.drafts ? `${d.clashes.drafts} in ${d.clashes.draftCount} draft(s) awaiting resolution` : "published timetable is clash-free"}
          href="/timetable"
        />
        <Stat label="Exams ready" value={`${d.counts.examReady}/${d.counts.exams}`} tone={d.counts.examReady === d.counts.exams ? "success" : "warn"} hint="seated + invigilators assigned" href="/exams" />
        <Stat label="Room utilisation" value={`${Math.round(d.rooms.overall * 100)}%`} hint={`${d.counts.sessions} sessions / week across ${d.counts.rooms} rooms`} href="/rooms" />
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mt-4">
        <Card title="Result processing pipeline" subtitle={`Spring 2026 sheets · ${d.sheets.total} module/cohort sheets`}>
          <div className="space-y-4">
            {(["DRAFT", "SUBMITTED", "APPROVED", "PUBLISHED"] as const).map((s) => (
              <div key={s}>
                <div className="flex justify-between text-[12px] mb-1.5">
                  <Status value={s} />
                  <span className="text-ink num">{d.sheets.counts[s]}</span>
                </div>
                <Bar value={d.sheets.counts[s]} max={d.sheets.total} tone={s === "PUBLISHED" ? "success" : s === "APPROVED" ? "warn" : s === "SUBMITTED" ? "info" : "rosso"} />
              </div>
            ))}
          </div>
          <Link href="/results" className="btn btn-outline btn-sm mt-6">
            Open results workflow
          </Link>
        </Card>

        <Card title="Weekly teaching load" subtitle="Published master timetable · sessions per day">
          <div className="flex items-end gap-3 h-40">
            {d.perDay.map((x) => (
              <div key={x.day} className="flex-1 flex flex-col items-center gap-2">
                <span className="text-[11px] text-ink num">{x.sessions}</span>
                <div className="w-full bg-elevated-3 relative" style={{ height: `${Math.max(4, (x.sessions / maxDay) * 100)}%` }}>
                  <div className="absolute inset-0 bg-info opacity-80" />
                </div>
                <span className="caps">{DAY_NAMES[x.day]}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 text-[12px] text-muted">
            Peak hour:{" "}
            <span className="text-ink">
              {(() => {
                const e = Object.entries(d.perHour).sort((a, b) => b[1] - a[1])[0];
                return e ? `${String(e[0]).padStart(2, "0")}:00 (${e[1]} sessions)` : "—";
              })()}
            </span>
          </div>
        </Card>

        <Card title="Faculty workload" subtitle={`${d.faculty.overloaded} lecturer(s) above weekly limit`}>
          <div className="space-y-3">
            {d.faculty.load.slice(0, 7).map((l) => (
              <div key={l.id}>
                <div className="flex justify-between text-[12px] mb-1">
                  <Link href={`/faculty/${l.id}`} className="text-ink hover:underline truncate">
                    {l.name}
                  </Link>
                  <span className={`num ${l.over ? "text-danger" : "text-muted"}`}>
                    {l.hours}/{l.max}h
                  </span>
                </div>
                <Bar value={l.hours} max={l.max} tone={l.over ? "danger" : l.hours / l.max > 0.85 ? "warn" : "info"} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mt-4">
        <Card title="Upcoming examinations" subtitle="Readiness = venues + seating + invigilators" className="xl:col-span-2" pad={false}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Module</th>
                <th>Groups</th>
                <th>Seated</th>
                <th>Invig.</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {d.upcoming.map((e) => (
                <tr key={e.id}>
                  <td className="ink whitespace-nowrap">
                    {fmtDate(e.date)} <span className="text-muted">{timeRange(e.startMin, e.endMin)}</span>
                  </td>
                  <td>
                    <Link href={`/exams/${e.id}`} className="text-ink hover:underline">
                      {e.module.code}
                    </Link>{" "}
                    <span className="text-muted">{e.module.name}</span>
                  </td>
                  <td>{e.cohorts.map((c) => c.cohort.code).join(", ")}</td>
                  <td className="num">{e._count.seats}</td>
                  <td className="num">{e._count.invigilations}</td>
                  <td>
                    <Status value={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Students needing support" subtitle="Risk score from average, fails, resits and trend" pad={false}>
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Group</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {risk.map((r) => (
                <tr key={r.student.id}>
                  <td>
                    <Link href={`/students/${r.student.id}`} className="text-ink hover:underline">
                      {r.student.firstName} {r.student.lastName}
                    </Link>
                    <div className="text-[11px] text-muted">{r.drivers.join(" · ")}</div>
                  </td>
                  <td>{r.student.cohort.code}</td>
                  <td>
                    <Pill tone={r.score >= 60 ? "danger" : "warn"}>{r.score}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mt-4">
        <Card title="Room utilisation" subtitle="Share of weekly teaching slots in use" className="xl:col-span-2">
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-3">
            {d.rooms.perRoom.map((r) => (
              <div key={r.id}>
                <div className="flex justify-between text-[12px] mb-1">
                  <Link href={`/rooms/${r.id}`} className="text-ink hover:underline">
                    {r.code} <span className="text-muted">· {r.type.toLowerCase()} · {r.capacity}</span>
                  </Link>
                  <span className="num text-muted">{Math.round(r.utilisation * 100)}%</span>
                </div>
                <Bar value={r.utilisation * 100} tone={r.utilisation > 0.7 ? "warn" : r.utilisation < 0.15 ? "rosso" : "info"} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Recent activity" subtitle="Audit trail of important changes" pad={false}>
          <ul>
            {d.recent.map((a) => (
              <li key={a.id} className="px-6 py-3 border-b border-hairline last:border-b-0">
                <div className="text-ink text-[13px]">{a.action.replace(/_/g, " ")}</div>
                <div className="text-[11px] text-muted">
                  {a.user?.name ?? "system"} · {a.entity} · {a.createdAt.toLocaleString("en-GB")}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
