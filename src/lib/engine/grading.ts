// Grading, validation, anomaly detection & progression rules (pure functions).

export type AssessmentLite = { id: string; name: string; weight: number; maxMarks: number };
export type MarkRow = {
  enrollmentId: string;
  studentId: string;
  studentNo: string;
  name: string;
  attempt: number;
  marks: Record<string, number | null>; // assessmentId -> marks
};

export const PASS_MARK = 40;
export const COMPONENT_THRESHOLD = 30;

export function gradeBand(overall: number | null): string {
  if (overall === null) return "—";
  if (overall >= 70) return "A";
  if (overall >= 60) return "B";
  if (overall >= 50) return "C";
  if (overall >= 40) return "D";
  return "F";
}

export function classification(avg: number): string {
  if (avg >= 70) return "First Class";
  if (avg >= 60) return "Upper Second (2:1)";
  if (avg >= 50) return "Lower Second (2:2)";
  if (avg >= 40) return "Third Class";
  return "Fail";
}

export type ComputedResult = {
  overall: number | null;
  grade: string;
  passed: boolean | null; // null when incomplete
  complete: boolean;
  componentFail: boolean;
};

export function computeResult(row: MarkRow, assessments: AssessmentLite[]): ComputedResult {
  let total = 0;
  let weightSum = 0;
  let complete = true;
  let componentFail = false;
  for (const a of assessments) {
    const m = row.marks[a.id];
    if (m === null || m === undefined) {
      complete = false;
      continue;
    }
    const pct = (m / a.maxMarks) * 100;
    if (pct < COMPONENT_THRESHOLD) componentFail = true;
    total += pct * a.weight;
    weightSum += a.weight;
  }
  if (!complete || weightSum === 0) return { overall: null, grade: "—", passed: null, complete: false, componentFail };
  const overall = Math.round((total / weightSum) * 10) / 10;
  const passed = overall >= PASS_MARK && !componentFail;
  return { overall, grade: passed ? gradeBand(overall) : "F", passed, complete: true, componentFail };
}

export type ValidationIssue = {
  type: "MISSING" | "OUT_OF_RANGE" | "DUPLICATE" | "COMPONENT_FAIL" | "SUSPICIOUS";
  severity: "ERROR" | "WARNING";
  studentNo: string;
  enrollmentId: string;
  message: string;
};

export function validateSheet(rows: MarkRow[], assessments: AssessmentLite[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.studentNo)) {
      issues.push({ type: "DUPLICATE", severity: "ERROR", studentNo: r.studentNo, enrollmentId: r.enrollmentId, message: `Duplicate entry for ${r.studentNo}` });
    }
    seen.add(r.studentNo);
    for (const a of assessments) {
      const m = r.marks[a.id];
      if (m === null || m === undefined) {
        issues.push({ type: "MISSING", severity: "ERROR", studentNo: r.studentNo, enrollmentId: r.enrollmentId, message: `${a.name} mark missing` });
      } else if (m < 0 || m > a.maxMarks || Number.isNaN(m)) {
        issues.push({ type: "OUT_OF_RANGE", severity: "ERROR", studentNo: r.studentNo, enrollmentId: r.enrollmentId, message: `${a.name} = ${m} is outside 0–${a.maxMarks}` });
      }
    }
    const res = computeResult(r, assessments);
    if (res.complete && res.componentFail && (res.overall ?? 0) >= PASS_MARK) {
      issues.push({ type: "COMPONENT_FAIL", severity: "WARNING", studentNo: r.studentNo, enrollmentId: r.enrollmentId, message: `Overall ${res.overall} but a component is below ${COMPONENT_THRESHOLD}% — fails on component rule` });
    }
  }
  return issues;
}

// ── Statistics & anomaly detection ──
export function stats(values: number[]) {
  const n = values.length;
  if (!n) return { n: 0, mean: 0, sd: 0, min: 0, max: 0, median: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const sorted = [...values].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { n, mean: round1(mean), sd: round1(sd), min: sorted[0], max: sorted[n - 1], median };
}

export const round1 = (x: number) => Math.round(x * 10) / 10;

export type Anomaly = { kind: string; severity: "HIGH" | "MEDIUM" | "LOW"; message: string; studentNo?: string };

/**
 * Flags unusual patterns in a result sheet:
 *  - cohort mean far from the historical module mean,
 *  - abnormal fail rate,
 *  - clusters of identical marks (possible copy/paste),
 *  - a student far from their own running average (z-score),
 *  - large coursework vs exam divergence.
 */
export function detectAnomalies(
  rows: MarkRow[],
  assessments: AssessmentLite[],
  historicalMean: number | null,
  studentAverages: Map<string, number>,
): Anomaly[] {
  const out: Anomaly[] = [];
  const overalls = rows.map((r) => computeResult(r, assessments)).filter((r) => r.overall !== null) as { overall: number; passed: boolean }[];
  if (overalls.length < 5) return out;
  const st = stats(overalls.map((o) => o.overall));
  if (historicalMean !== null && Math.abs(st.mean - historicalMean) >= 12) {
    out.push({
      kind: "MEAN_SHIFT",
      severity: "HIGH",
      message: `Cohort mean ${st.mean} deviates from the module's historical mean ${round1(historicalMean)} by ${round1(st.mean - historicalMean)} points`,
    });
  }
  const failRate = overalls.filter((o) => !o.passed).length / overalls.length;
  if (failRate >= 0.35) out.push({ kind: "HIGH_FAIL_RATE", severity: "HIGH", message: `${Math.round(failRate * 100)}% of the cohort is failing` });
  else if (failRate === 0 && overalls.length >= 15 && st.min >= 55) out.push({ kind: "NO_FAILS", severity: "LOW", message: `No fails and minimum ${st.min} — unusually uniform outcome` });
  if (st.sd < 4) out.push({ kind: "LOW_SPREAD", severity: "MEDIUM", message: `Standard deviation only ${st.sd} — marks unusually clustered` });

  for (const a of assessments) {
    const counts = new Map<number, number>();
    for (const r of rows) {
      const m = r.marks[a.id];
      if (m !== null && m !== undefined) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    for (const [m, c] of counts) {
      if (c >= Math.max(5, rows.length * 0.25)) {
        out.push({ kind: "IDENTICAL_CLUSTER", severity: "MEDIUM", message: `${c} students share exactly ${m} in ${a.name} — check for copy-paste entry` });
      }
    }
  }

  for (const r of rows) {
    const res = computeResult(r, assessments);
    if (res.overall === null) continue;
    const avg = studentAverages.get(r.studentId);
    if (avg !== undefined && st.sd > 0) {
      const diff = res.overall - avg;
      if (Math.abs(diff) >= 25) {
        out.push({
          kind: "STUDENT_OUTLIER",
          severity: "MEDIUM",
          studentNo: r.studentNo,
          message: `${r.name} (${r.studentNo}) scored ${res.overall} vs personal average ${round1(avg)} (${diff > 0 ? "+" : ""}${round1(diff)})`,
        });
      }
    }
    if (assessments.length >= 2) {
      const pcts = assessments.map((a) => (r.marks[a.id] ?? 0) / a.maxMarks * 100);
      if (Math.max(...pcts) - Math.min(...pcts) >= 45) {
        out.push({ kind: "COMPONENT_DIVERGENCE", severity: "LOW", studentNo: r.studentNo, message: `${r.name}: ${assessments.map((a, i) => `${a.name} ${Math.round(pcts[i])}`).join(" vs ")}` });
      }
    }
  }
  return out;
}

// ── Progression ──
export type ProgressionInput = { moduleCode: string; credits: number; overall: number | null; passed: boolean | null }[];

export function progressionDecision(results: ProgressionInput) {
  const complete = results.filter((r) => r.overall !== null);
  if (complete.length < results.length) {
    return { decision: "REVIEW", average: avg(complete.map((r) => r.overall!)), failedCredits: 0, note: "Results incomplete" };
  }
  const failed = complete.filter((r) => !r.passed);
  const failedCredits = failed.reduce((a, r) => a + r.credits, 0);
  const average = avg(complete.map((r) => r.overall!));
  if (!failed.length) return { decision: "PROGRESS", average, failedCredits, note: "All modules passed" };
  if (failedCredits <= 40) return { decision: "PROGRESS_WITH_RESIT", average, failedCredits, note: `Resit required: ${failed.map((f) => f.moduleCode).join(", ")}` };
  return { decision: "REPEAT", average, failedCredits, note: `${failedCredits} failed credits exceeds the 40-credit carry limit` };
}

function avg(v: number[]) {
  return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : 0;
}

// ── At-risk scoring (0–100) ──
export function riskScore(input: { average: number | null; fails: number; resits: number; trend: number | null; incomplete: number }) {
  let s = 0;
  if (input.average !== null) {
    if (input.average < 40) s += 45;
    else if (input.average < 45) s += 30;
    else if (input.average < 50) s += 15;
  }
  s += Math.min(30, input.fails * 15);
  s += Math.min(20, input.resits * 10);
  if (input.trend !== null && input.trend <= -8) s += 15;
  s += Math.min(10, input.incomplete * 5);
  return Math.min(100, s);
}
