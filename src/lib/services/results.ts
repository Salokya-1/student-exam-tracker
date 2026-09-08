// Result-workflow services (shared by server actions and the agent).
import { prisma } from "../prisma";
import { audit } from "../audit";
import { can } from "../rbac";
import { loadSheet } from "../data/results";
import { computeResult, progressionDecision } from "../engine/grading";
import type { Role, SheetStatus } from "../constants";

export const TRANSITIONS: Record<string, { from: SheetStatus[]; to: SheetStatus; perm: string; action: string }> = {
  submit: { from: ["DRAFT"], to: "SUBMITTED", perm: "results:enter", action: "RESULTS_SUBMITTED" },
  approve: { from: ["SUBMITTED"], to: "APPROVED", perm: "results:approve", action: "RESULTS_APPROVED" },
  reject: { from: ["SUBMITTED", "APPROVED"], to: "DRAFT", perm: "results:approve", action: "RESULTS_REJECTED" },
  publish: { from: ["APPROVED"], to: "PUBLISHED", perm: "results:publish", action: "RESULTS_PUBLISHED" },
  reopen: { from: ["PUBLISHED"], to: "DRAFT", perm: "results:publish", action: "RESULTS_REOPENED" },
};

export async function resolveSheetId(ref: string, cohortCode?: string, term?: string): Promise<string | null> {
  const byId = await prisma.resultSheet.findUnique({ where: { id: ref } });
  if (byId) return byId.id;
  const s = await prisma.resultSheet.findFirst({
    where: { module: { code: ref.toUpperCase() }, ...(cohortCode ? { cohort: { code: cohortCode.toUpperCase() } } : {}), ...(term ? { term } : {}) },
    orderBy: [{ term: "desc" }, { status: "asc" }],
  });
  return s?.id ?? null;
}

export async function transitionResultSheet(sheetId: string, op: string, note: string, user: { id: string; role: Role }) {
  const t = TRANSITIONS[op];
  if (!t) return { ok: false as const, error: `Unknown operation ${op}` };
  if (!can(user.role, t.perm)) return { ok: false as const, error: `Your role (${user.role}) cannot ${op} result sheets` };
  const data = await loadSheet(sheetId);
  if (!data) return { ok: false as const, error: "Sheet not found" };
  if (!t.from.includes(data.sheet.status as SheetStatus)) return { ok: false as const, error: `Cannot ${op} a ${data.sheet.status} sheet` };
  const errors = data.issues.filter((i) => i.severity === "ERROR");
  if ((op === "submit" || op === "approve" || op === "publish") && errors.length) {
    return { ok: false as const, error: `Blocked: ${errors.length} validation error(s) must be fixed first`, issues: errors.slice(0, 10).map((e) => `${e.studentNo}: ${e.message}`) };
  }
  const now = new Date();
  await prisma.resultSheet.update({
    where: { id: sheetId },
    data: {
      status: t.to,
      note: note || undefined,
      ...(op === "submit" ? { submittedBy: user.id, submittedAt: now } : {}),
      ...(op === "approve" ? { approvedBy: user.id, approvedAt: now } : {}),
      ...(op === "publish" ? { publishedAt: now } : {}),
      ...(op === "reject" || op === "reopen" ? { submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, publishedAt: null } : {}),
    },
  });
  let effects: { failed: number; resits: number; progressions: number } | undefined;
  if (op === "publish") effects = await applyPublication(sheetId);
  await audit(user.id, t.action, "ResultSheet", sheetId, { module: data.sheet.module.code, cohort: data.sheet.cohort.code, term: data.sheet.term, note, effects });
  return { ok: true as const, status: t.to, module: data.sheet.module.code, cohort: data.sheet.cohort.code, term: data.sheet.term, anomalies: data.anomalies.length, effects };
}

/** Publication side-effects: enrolment outcomes, resit records, progression decisions, standing. */
async function applyPublication(sheetId: string) {
  const data = await loadSheet(sheetId);
  if (!data) return { failed: 0, resits: 0, progressions: 0 };
  const term = data.sheet.term;
  let failed = 0;
  let resits = 0;
  for (const { row, result } of data.results) {
    if (result.overall === null) continue;
    await prisma.moduleEnrollment.update({ where: { id: row.enrollmentId }, data: { status: result.passed ? "PASSED" : "FAILED" } });
    if (!result.passed) {
      failed++;
      const existing = await prisma.resit.findFirst({ where: { enrollmentId: row.enrollmentId } });
      if (!existing) {
        await prisma.resit.create({ data: { enrollmentId: row.enrollmentId, reason: result.componentFail && result.overall >= 40 ? "Component below threshold" : "Overall mark below 40", term: nextTerm(term), outcome: "PENDING" } });
        resits++;
      }
    }
  }
  let progressions = 0;
  for (const sid of data.rows.map((r) => r.studentId)) {
    const enrols = await prisma.moduleEnrollment.findMany({ where: { studentId: sid, term }, include: { module: { include: { assessments: true } }, marks: { include: { sheet: true } } } });
    if (!enrols.every((e) => e.marks.length && e.marks.every((m) => m.sheet.status === "PUBLISHED"))) continue;
    const input = enrols.map((e) => {
      const marks: Record<string, number | null> = {};
      for (const m of e.marks) marks[m.assessmentId] = m.marks;
      const res = computeResult({ enrollmentId: e.id, studentId: sid, studentNo: "", name: "", attempt: e.attempt, marks }, e.module.assessments);
      return { moduleCode: e.module.code, credits: e.module.credits, overall: res.overall, passed: res.passed };
    });
    const d = progressionDecision(input);
    const existing = await prisma.progressionRecord.findFirst({ where: { studentId: sid, term } });
    const rec = { decision: d.decision, average: d.average, credits: input.filter((i) => i.passed).reduce((a, i) => a + i.credits, 0), note: d.note };
    if (existing) await prisma.progressionRecord.update({ where: { id: existing.id }, data: rec });
    else await prisma.progressionRecord.create({ data: { studentId: sid, term, ...rec } });
    const standing = d.decision === "REPEAT" ? "PROBATION" : d.decision === "PROGRESS_WITH_RESIT" || d.average < 45 ? "AT_RISK" : "GOOD";
    await prisma.student.update({ where: { id: sid }, data: { standing } });
    progressions++;
  }
  return { failed, resits, progressions };
}

function nextTerm(term: string) {
  const [y, s] = term.split("-");
  return s === "AUT" ? `${Number(y) + 1}-SPR` : `${y}-AUT`;
}
