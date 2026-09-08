
import { prisma } from "../prisma";
import { computeResult, detectAnomalies, stats, validateSheet, type AssessmentLite, type MarkRow } from "../engine/grading";

export async function loadSheet(sheetId: string) {
  const sheet = await prisma.resultSheet.findUnique({
    where: { id: sheetId },
    include: {
      module: { include: { assessments: true } },
      cohort: true,
      marks: { include: { enrollment: { include: { student: true } } } },
    },
  });
  if (!sheet) return null;
  const assessments: AssessmentLite[] = sheet.module.assessments.map((a) => ({ id: a.id, name: a.name, weight: a.weight, maxMarks: a.maxMarks }));
  const byEnrol = new Map<string, MarkRow>();
  for (const m of sheet.marks) {
    const e = m.enrollment;
    let row = byEnrol.get(e.id);
    if (!row) {
      row = { enrollmentId: e.id, studentId: e.studentId, studentNo: e.student.studentNo, name: `${e.student.firstName} ${e.student.lastName}`, attempt: e.attempt, marks: {} };
      byEnrol.set(e.id, row);
    }
    row.marks[m.assessmentId] = m.marks;
  }
  const rows = [...byEnrol.values()].sort((a, b) => a.studentNo.localeCompare(b.studentNo));
  const results = rows.map((r) => ({ row: r, result: computeResult(r, assessments) }));
  const issues = validateSheet(rows, assessments);

  const [historicalMean, studentAvgs] = await Promise.all([
    moduleHistoricalMean(sheet.moduleId, sheet.id),
    studentAverages(rows.map((r) => r.studentId), sheet.id),
  ]);
  const anomalies = detectAnomalies(rows, assessments, historicalMean, studentAvgs);
  const overalls = results.map((r) => r.result.overall).filter((x): x is number => x !== null);
  const st = stats(overalls);
  const passCount = results.filter((r) => r.result.passed).length;
  const gradeDist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const r of results) if (r.result.complete) gradeDist[r.result.grade] = (gradeDist[r.result.grade] ?? 0) + 1;

  return {
    sheet,
    assessments,
    rows,
    results,
    issues,
    anomalies,
    stats: { ...st, passCount, passRate: overalls.length ? Math.round((passCount / overalls.length) * 100) : 0, complete: overalls.length, total: rows.length, historicalMean, gradeDist },
  };
}

export async function moduleHistoricalMean(moduleId: string, excludeSheetId?: string): Promise<number | null> {
  const sheets = await prisma.resultSheet.findMany({
    where: { moduleId, status: "PUBLISHED", NOT: excludeSheetId ? { id: excludeSheetId } : undefined },
    include: { module: { include: { assessments: true } }, marks: true },
  });
  const values: number[] = [];
  for (const s of sheets) {
    const assessments = s.module.assessments.map((a) => ({ id: a.id, name: a.name, weight: a.weight, maxMarks: a.maxMarks }));
    const byEnrol = new Map<string, Record<string, number | null>>();
    for (const m of s.marks) {
      const r = byEnrol.get(m.enrollmentId) ?? {};
      r[m.assessmentId] = m.marks;
      byEnrol.set(m.enrollmentId, r);
    }
    for (const [eid, marks] of byEnrol) {
      const res = computeResult({ enrollmentId: eid, studentId: "", studentNo: "", name: "", attempt: 1, marks }, assessments);
      if (res.overall !== null) values.push(res.overall);
    }
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Average published overall mark per student (excluding the given sheet). */
export async function studentAverages(studentIds: string[], excludeSheetId?: string): Promise<Map<string, number>> {
  if (!studentIds.length) return new Map();
  const marks = await prisma.mark.findMany({
    where: { enrollment: { studentId: { in: studentIds } }, sheet: { status: "PUBLISHED", NOT: excludeSheetId ? { id: excludeSheetId } : undefined } },
    include: { assessment: true, enrollment: { select: { studentId: true } } },
  });
  // group by enrollment
  const byEnrol = new Map<string, { studentId: string; marks: Record<string, number | null>; assessments: AssessmentLite[] }>();
  for (const m of marks) {
    const e = byEnrol.get(m.enrollmentId) ?? { studentId: m.enrollment.studentId, marks: {}, assessments: [] };
    e.marks[m.assessmentId] = m.marks;
    if (!e.assessments.find((a) => a.id === m.assessmentId)) e.assessments.push({ id: m.assessmentId, name: m.assessment.name, weight: m.assessment.weight, maxMarks: m.assessment.maxMarks });
    byEnrol.set(m.enrollmentId, e);
  }
  const acc = new Map<string, number[]>();
  for (const [eid, e] of byEnrol) {
    const res = computeResult({ enrollmentId: eid, studentId: e.studentId, studentNo: "", name: "", attempt: 1, marks: e.marks }, e.assessments);
    if (res.overall !== null) acc.set(e.studentId, [...(acc.get(e.studentId) ?? []), res.overall]);
  }
  return new Map([...acc].map(([sid, v]) => [sid, v.reduce((a, b) => a + b, 0) / v.length]));
}

/** Full academic record for one student: every enrolment with computed result & sheet status. */
export async function studentRecord(studentId: string) {
  const enrolments = await prisma.moduleEnrollment.findMany({
    where: { studentId },
    include: {
      module: { include: { assessments: true } },
      marks: { include: { sheet: { select: { id: true, status: true, publishedAt: true } } } },
      resits: true,
    },
    orderBy: [{ term: "asc" }, { module: { code: "asc" } }],
  });
  return enrolments.map((e) => {
    const assessments = e.module.assessments.map((a) => ({ id: a.id, name: a.name, weight: a.weight, maxMarks: a.maxMarks }));
    const marks: Record<string, number | null> = {};
    for (const m of e.marks) marks[m.assessmentId] = m.marks;
    const result = computeResult({ enrollmentId: e.id, studentId, studentNo: "", name: "", attempt: e.attempt, marks }, assessments);
    const sheetStatus = e.marks[0]?.sheet.status ?? "DRAFT";
    return { enrolment: e, assessments, marks, result, sheetStatus, sheetId: e.marks[0]?.sheet.id ?? null };
  });
}
