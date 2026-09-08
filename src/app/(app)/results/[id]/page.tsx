import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { requireRole, can } from "@/lib/auth";
import { loadSheet } from "@/lib/data/results";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, Pill, Status, KV, Bar } from "@/components/ui";
import { BackLink } from "@/components/Shell";
import { MarksGrid } from "@/components/MarksGrid";
import { importCsv, saveMarks, transitionSheet } from "../actions";

export const dynamic = "force-dynamic";

export default async function SheetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const user = await requireRole("ADMIN", "RTE_STAFF", "LECTURER");
  const { id } = await params;
  const { msg } = await searchParams;
  const data = await loadSheet(id);
  if (!data) notFound();
  const { sheet, assessments, rows, results, issues, anomalies, stats } = data;
  const editable = sheet.status === "DRAFT" && can(user.role, "results:enter");
  const errors = issues.filter((i) => i.severity === "ERROR");
  const warnings = issues.filter((i) => i.severity === "WARNING");
  const people = await prisma.user.findMany({ where: { id: { in: [sheet.submittedBy, sheet.approvedBy].filter(Boolean) as string[] } } });
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? (id ? "Lecturer" : "—");
  const history = await prisma.auditLog.findMany({ where: { entity: "ResultSheet", entityId: id }, orderBy: { createdAt: "desc" }, take: 10, include: { user: true } });

  const steps = ["DRAFT", "SUBMITTED", "APPROVED", "PUBLISHED"];
  const stepIdx = steps.indexOf(sheet.status);

  return (
    <>
      <BackLink href="/results">Result sheets</BackLink>
      <PageHeader
        eyebrow={`${sheet.term} · ${sheet.cohort.code} · ${rows.length} students`}
        title={`${sheet.module.code} — ${sheet.module.name}`}
        description={`Assessment scheme: ${assessments.map((a) => `${a.name} ${a.weight}%`).join(" + ")}. Pass mark 40 with every component ≥ 30%.`}
        actions={<Status value={sheet.status} />}
      />

      {msg && <div className="mb-4 border border-hairline-2 bg-elevated px-4 py-3 text-ink text-[13px]">{msg}</div>}

      {/* workflow */}
      <Card className="mb-4">
        <div className="grid md:grid-cols-[1fr_auto] gap-6 items-center">
          <ol className="flex items-center gap-2">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className={`h-7 w-7 inline-flex items-center justify-center text-[11px] font-bold ${i <= stepIdx ? "bg-rosso text-white" : "bg-elevated-3 text-muted"}`}>{i + 1}</span>
                <span className={`nav-link ${i <= stepIdx ? "text-ink" : "text-muted"}`}>{s}</span>
                {i < steps.length - 1 && <span className="w-8 h-px bg-hairline-2 mx-1" />}
              </li>
            ))}
          </ol>
          <div className="text-[12px] text-muted">
            <div>Submitted: {sheet.submittedAt ? `${nameOf(sheet.submittedBy)} · ${sheet.submittedAt.toLocaleDateString("en-GB")}` : "—"}</div>
            <div>Approved: {sheet.approvedAt ? `${nameOf(sheet.approvedBy)} · ${sheet.approvedAt.toLocaleDateString("en-GB")}` : "—"}</div>
            <div>Published: {sheet.publishedAt ? sheet.publishedAt.toLocaleDateString("en-GB") : "—"}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-6 no-print">
          <WorkflowButton sheetId={id} op="submit" label="Submit for approval" show={sheet.status === "DRAFT" && can(user.role, "results:enter")} disabled={errors.length > 0} primary />
          <WorkflowButton sheetId={id} op="approve" label="Approve" show={sheet.status === "SUBMITTED" && can(user.role, "results:approve")} disabled={errors.length > 0} primary />
          <WorkflowButton sheetId={id} op="reject" label="Return to lecturer" show={["SUBMITTED", "APPROVED"].includes(sheet.status) && can(user.role, "results:approve")} withNote />
          <WorkflowButton sheetId={id} op="publish" label="Publish to students" show={sheet.status === "APPROVED" && can(user.role, "results:publish")} disabled={errors.length > 0} primary />
          <WorkflowButton sheetId={id} op="reopen" label="Reopen for correction" show={sheet.status === "PUBLISHED" && can(user.role, "results:publish")} withNote />
          {errors.length > 0 && <span className="text-danger text-[12px] self-center">Blocked by {errors.length} validation error(s)</span>}
          {sheet.status === "PUBLISHED" && <span className="text-success text-[12px] self-center">Visible to students · outcomes, resits and progression applied automatically</span>}
        </div>
        {sheet.note && <p className="mt-3 text-[12px] text-warn">Note: {sheet.note}</p>}
      </Card>

      <div className="grid xl:grid-cols-4 gap-4">
        <Card title="Statistics">
          <KV k="Complete" v={`${stats.complete}/${stats.total}`} />
          <KV k="Mean" v={stats.mean} />
          <KV k="Median" v={stats.median} />
          <KV k="Std dev" v={stats.sd} />
          <KV k="Range" v={`${stats.min}–${stats.max}`} />
          <KV k="Pass rate" v={`${stats.passRate}%`} />
          <KV k="Historical mean" v={stats.historicalMean !== null ? stats.historicalMean.toFixed(1) : "n/a"} />
          <div className="mt-4 space-y-2">
            {Object.entries(stats.gradeDist).map(([g, n]) => (
              <div key={g} className="flex items-center gap-3 text-[12px]">
                <span className="w-4 text-ink">{g}</span>
                <div className="flex-1">
                  <Bar value={n} max={Math.max(1, stats.complete)} tone={g === "F" ? "danger" : g === "A" ? "success" : "info"} />
                </div>
                <span className="w-6 text-right num">{n}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Validation" subtitle={`${errors.length} errors · ${warnings.length} warnings`}>
          {issues.length === 0 ? (
            <p className="text-success text-[13px]">All marks present and within range.</p>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-auto pr-1">
              {issues.slice(0, 40).map((i, k) => (
                <li key={k} className="text-[12px] flex gap-2">
                  <Status value={i.severity} />
                  <span>
                    <span className="text-ink num">{i.studentNo}</span> · {i.message}
                  </span>
                </li>
              ))}
              {issues.length > 40 && <li className="text-muted text-[12px]">…and {issues.length - 40} more</li>}
            </ul>
          )}
        </Card>

        <Card title="Anomaly detection" subtitle="Statistical checks before approval" className="xl:col-span-2">
          {anomalies.length === 0 ? (
            <p className="text-success text-[13px]">No unusual patterns detected.</p>
          ) : (
            <ul className="space-y-2">
              {anomalies.map((a, k) => (
                <li key={k} className="flex gap-3 text-[13px]">
                  <Status value={a.severity} />
                  <span>
                    <Pill className="mr-2">{a.kind.replace(/_/g, " ")}</Pill>
                    {a.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Marks"
        subtitle={editable ? "Edit inline or import a CSV. Overall & grade recalculate live." : "Read-only — sheet is locked at this stage"}
        className="mt-4"
        pad={false}
        actions={
          editable ? (
            <details className="relative">
              <summary className="btn btn-outline btn-sm cursor-pointer list-none">Import CSV</summary>
              <ActionForm action={importCsv.bind(null, id)} className="absolute right-0 top-10 z-10 w-[380px] card card-pad space-y-3">
                <p className="text-[12px] text-muted">
                  Columns: <code className="text-ink">studentNo, {assessments.map((a) => a.name).join(", ")}</code>.{" "}
                  <a className="underline" href={`/api/results/${id}/template`}>
                    Download template
                  </a>
                </p>
                <input type="file" name="file" accept=".csv,text/csv" className="text-[12px]" />
                <textarea name="csv" rows={5} className="input h-auto py-2 text-[12px] font-mono" placeholder={`studentNo,${assessments.map((a) => a.name).join(",")}\n${rows[0]?.studentNo ?? "20250001"},62,55`} />
                <SubmitButton className="btn btn-primary btn-sm w-full">Import</SubmitButton>
              </ActionForm>
            </details>
          ) : null
        }
      >
        <MarksGrid sheetId={id} rows={rows} assessments={assessments} editable={editable} save={saveMarks} />
      </Card>

      <Card title="Sheet history" className="mt-4" pad={false}>
        <table className="table">
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td className="ink w-56">{h.action.replace(/_/g, " ")}</td>
                <td>{h.user?.name ?? "system"}</td>
                <td className="text-[12px] text-muted">{h.details && JSON.parse(h.details).note}</td>
                <td className="text-[12px] text-right">{h.createdAt.toLocaleString("en-GB")}</td>
              </tr>
            ))}
            {!history.length && (
              <tr>
                <td className="text-muted">No changes recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <div className="hidden">{results.length}</div>
    </>
  );
}

function WorkflowButton({ sheetId, op, label, show, disabled, primary, withNote }: { sheetId: string; op: string; label: string; show: boolean; disabled?: boolean; primary?: boolean; withNote?: boolean }) {
  if (!show) return null;
  return (
    <ActionForm action={transitionSheet} className="flex items-center gap-2">
      <input type="hidden" name="sheetId" value={sheetId} />
      <input type="hidden" name="op" value={op} />
      {withNote && <input name="note" className="input input-sm w-56" placeholder="Reason (recorded in audit)" required />}
      <SubmitButton className={`btn btn-sm ${primary ? "btn-primary" : "btn-outline"}`} disabled={disabled}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
