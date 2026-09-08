// Agent tools: what the AI assistant can read and do inside RTE Hub.
// Every tool is role-gated with the same permission matrix as the UI, and
// every action goes through the shared services (so it is audited exactly
// like a click in the interface).
import { prisma } from "../prisma";
import { can } from "../rbac";
import { DAY_NAMES, TERMS, fmtDate, minToTime, timeRange, type Role } from "../constants";
import type { CurrentUser } from "../auth";
import { execute as nlqExecute } from "../engine/nlq";
import { detectClashes, clashLabel } from "../engine/clash";
import { loadSessions, lecturerLimits } from "../data/timetable";
import { loadSheet, studentRecord } from "../data/results";
import { dashboardData } from "../data/analytics";
import { generateTimetableOption, publishTimetableById, autoResolveTimetable, moveSession, deleteTimetableById } from "../services/timetable";
import { allocateVenuesFor, generateSeatingFor, assignInvigilatorsFor, createExamRecord, resolveExamId } from "../services/exams";
import { transitionResultSheet, resolveSheetId } from "../services/results";
import { reassignAssignment, findAssignment } from "../services/faculty";

import { ADMIN_TOOLS, runAdminTool } from "./adminTools";
import { int, str, type Args, type ToolDef, type ToolOutcome } from "./types";

export type { ToolDef, ToolOutcome } from "./types";
const dayOf = (v: unknown): number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return v;
  const w = String(v).toLowerCase();
  if (w === "today") return new Date().getDay();
  if (w === "tomorrow") return (new Date().getDay() + 1) % 7;
  const i = DAY_NAMES.findIndex((d) => w.startsWith(d.toLowerCase()));
  return i >= 0 ? i : null;
};

const CORE_TOOLS: ToolDef[] = [
  // ── read ──
  { name: "system_overview", kind: "read", description: "Key operational numbers: students, at-risk, result processing progress, timetable clashes, exam readiness, room utilisation, overloaded lecturers.", parameters: { type: "object", properties: {} } },
  { name: "search_students", kind: "read", perm: "students:view", description: "Find students by name, student number or email (max 10).", parameters: { type: "object", properties: { query: str("name, number or email fragment"), cohortCode: str("optional group code e.g. L5COG1") }, required: ["query"] } },
  { name: "student_record", kind: "read", description: "Full academic record of one student: modules per term, marks, grades, outcomes, resits, progression, seats. Students may only view themselves.", parameters: { type: "object", properties: { studentNo: str("8-digit student number") }, required: ["studentNo"] } },
  { name: "seat_lookup", kind: "read", description: "Exam seat(s) allocated to a student.", parameters: { type: "object", properties: { studentNo: str("8-digit student number") }, required: ["studentNo"] } },
  { name: "timetable", kind: "read", description: "Weekly timetable sessions for a student group, lecturer, room or module, optionally filtered to one day.", parameters: { type: "object", properties: { entityType: { type: "string", enum: ["cohort", "lecturer", "room", "module"] }, code: str("group code (L5COG1), lecturer name, room code (LB-201) or module code (CS5001)"), day: str("optional day name") }, required: ["entityType", "code"] } },
  { name: "free_rooms", kind: "read", description: "Rooms free at a given day and hour (07–16), optionally with a minimum capacity, or whether one room is free.", parameters: { type: "object", properties: { day: str("day name e.g. Tuesday"), hour: int("hour 7..16"), minCapacity: int("minimum seats"), roomCode: str("optional single room to check") }, required: ["day", "hour"] } },
  { name: "lecturer_workload", kind: "read", description: "Weekly contact hours vs limit for one lecturer, or the overload ranking for everyone.", parameters: { type: "object", properties: { name: str("lecturer name (optional)") } } },
  { name: "module_results", kind: "read", perm: "students:view", description: "Result statistics for a module across its sheets: mean, pass rate, fails, anomalies.", parameters: { type: "object", properties: { moduleCode: str("e.g. CS4005") }, required: ["moduleCode"] } },
  { name: "list_result_sheets", kind: "read", perm: "results:enter", description: "Result sheets with status and completeness. Filter by term (2026-SPR), status (DRAFT|SUBMITTED|APPROVED|PUBLISHED) or module.", parameters: { type: "object", properties: { term: str("term e.g. 2026-SPR"), status: str("status"), moduleCode: str("module code") } } },
  { name: "sheet_details", kind: "read", perm: "results:enter", description: "One result sheet: status, statistics, validation errors, anomaly flags. Identify by sheetId or moduleCode (+ cohortCode).", parameters: { type: "object", properties: { sheetId: str("sheet id"), moduleCode: str("module code"), cohortCode: str("group code"), term: str("term") } } },
  { name: "list_timetables", kind: "read", description: "Timetable versions for the current term with session and conflict counts.", parameters: { type: "object", properties: {} } },
  { name: "timetable_conflicts", kind: "read", description: "Conflicts (double bookings, lecturer clashes, group overlaps, capacity) in a timetable version. Defaults to the published one.", parameters: { type: "object", properties: { timetableId: str("timetable id (optional)") } } },
  { name: "list_exams", kind: "read", description: "Examination sessions with date, time, groups, venues, seats, invigilators and status.", parameters: { type: "object", properties: { status: str("PLANNED|VENUES_ALLOCATED|SEATED|READY|COMPLETED"), moduleCode: str("module code") } } },
  { name: "exam_details", kind: "read", description: "Details of one exam incl. venues, seating summary and invigilators. examRef = exam id or module code.", parameters: { type: "object", properties: { examRef: str("exam id or module code") }, required: ["examRef"] } },
  { name: "at_risk_students", kind: "read", perm: "students:view", description: "Students flagged for academic support with risk score and drivers, optionally in one group.", parameters: { type: "object", properties: { cohortCode: str("group code (optional)") } } },
  { name: "room_utilisation", kind: "read", description: "Most and least used rooms in the published timetable.", parameters: { type: "object", properties: {} } },
  // ── actions ──
  { name: "generate_timetable", kind: "action", perm: "timetable:edit", description: "Run the constraint solver to create a new clash-free DRAFT timetable option for the current term.", parameters: { type: "object", properties: { name: str("option name"), seed: int("random seed (default 42)"), maxLecturerDaily: int("max lecturer hours per day (default 4)"), maxCohortDaily: int("max group hours per day (default 6)") } } },
  { name: "publish_timetable", kind: "action", perm: "timetable:edit", description: "Publish a DRAFT timetable version (archives the current published one). Fails while hard conflicts remain.", parameters: { type: "object", properties: { timetableId: str("timetable id") }, required: ["timetableId"] } },
  { name: "auto_resolve_conflicts", kind: "action", perm: "timetable:edit", description: "Automatically move clashing sessions in a DRAFT timetable to free rooms/slots.", parameters: { type: "object", properties: { timetableId: str("timetable id") }, required: ["timetableId"] } },
  { name: "delete_timetable", kind: "action", perm: "timetable:edit", description: "Delete a DRAFT timetable version.", parameters: { type: "object", properties: { timetableId: str("timetable id") }, required: ["timetableId"] } },
  { name: "move_session", kind: "action", perm: "timetable:edit", description: "Move one timetable session to another room, day/hour and/or lecturer with conflict checking. Get sessionId from the timetable tool.", parameters: { type: "object", properties: { sessionId: str("session id"), roomCode: str("new room code"), day: str("new day name"), hour: int("new start hour 7..16"), lecturerName: str("new lecturer"), override: { type: "boolean", description: "force despite hard conflicts (audited)" } }, required: ["sessionId"] } },
  { name: "reassign_teaching", kind: "action", perm: "timetable:edit", description: "Move a module/group teaching allocation (lecture, tutorial or lab) to another lecturer; timetable sessions follow.", parameters: { type: "object", properties: { moduleCode: str("module code"), cohortCode: str("group code"), sessionType: str("LECTURE|TUTORIAL|LAB (optional)"), newLecturerName: str("lecturer name") }, required: ["moduleCode", "cohortCode", "newLecturerName"] } },
  { name: "allocate_exam_venues", kind: "action", perm: "exams:edit", description: "Auto-allocate the best-fitting free venue(s) for an exam.", parameters: { type: "object", properties: { examRef: str("exam id or module code") }, required: ["examRef"] } },
  { name: "generate_exam_seating", kind: "action", perm: "exams:edit", description: "Generate the interleaved seating plan for an exam's sitting (venues must be allocated).", parameters: { type: "object", properties: { examRef: str("exam id or module code") }, required: ["examRef"] } },
  { name: "assign_invigilators", kind: "action", perm: "exams:edit", description: "Auto-assign chief/assistant invigilators for an exam's sitting (seating must exist).", parameters: { type: "object", properties: { examRef: str("exam id or module code") }, required: ["examRef"] } },
  { name: "prepare_exam", kind: "action", perm: "exams:edit", description: "One-shot: allocate venues, generate seating and assign invigilators for an exam.", parameters: { type: "object", properties: { examRef: str("exam id or module code") }, required: ["examRef"] } },
  { name: "create_exam", kind: "action", perm: "exams:edit", description: "Schedule a new examination session.", parameters: { type: "object", properties: { moduleCode: str("module code"), date: str("YYYY-MM-DD"), startTime: str("HH:MM 24h"), durationMin: int("minutes, default 120"), cohortCodes: { type: "array", items: { type: "string" }, description: "group codes" } }, required: ["moduleCode", "date", "startTime", "cohortCodes"] } },
  { name: "transition_result_sheet", kind: "action", perm: "results:enter", description: "Move a result sheet through the workflow: submit (DRAFT→SUBMITTED), approve (→APPROVED), publish (→PUBLISHED, applies outcomes/resits/progression), reject or reopen (→DRAFT). Role limits apply.", parameters: { type: "object", properties: { sheetRef: str("sheet id or module code"), cohortCode: str("group code when using a module code"), op: { type: "string", enum: ["submit", "approve", "publish", "reject", "reopen"] }, note: str("reason (required for reject/reopen)") }, required: ["sheetRef", "op"] } },
  { name: "open_page", kind: "action", description: "Navigate the user's browser to a page in RTE Hub, e.g. /timetable?tt=ID, /exams/ID, /results/ID, /students/ID, /rooms, /faculty.", parameters: { type: "object", properties: { path: str("app path starting with /") }, required: ["path"] } },
];

export const TOOLS: ToolDef[] = [...CORE_TOOLS, ...ADMIN_TOOLS];

export function toolsForRole(role: Role): ToolDef[] {
  return TOOLS.filter((t) => !t.perm || can(role, t.perm));
}

export function toOpenAITools(defs: ToolDef[]) {
  return defs.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

const clip = (v: unknown, max = 6000) => {
  const s = JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…(truncated)" : s;
};
export const serialise = clip;

export async function runTool(name: string, args: Args, user: CurrentUser): Promise<ToolOutcome> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { result: { error: `Unknown tool ${name}` } };
  if (def.perm && !can(user.role, def.perm)) return { result: { error: `Your role (${user.role}) is not permitted to use ${name}` } };
  const s = (k: string) => (args[k] === undefined || args[k] === null ? undefined : String(args[k]));
  const n = (k: string) => (args[k] === undefined || args[k] === null || args[k] === "" ? undefined : Number(args[k]));

  switch (name) {
    case "system_overview": {
      const d = await dashboardData();
      return { result: { students: d.counts.students, cohorts: d.counts.cohorts, atRisk: d.counts.atRisk, resultSheets: d.sheets, timetableClashes: d.clashes, exams: { total: d.counts.exams, ready: d.counts.examReady }, roomUtilisation: Math.round(d.rooms.overall * 100) + "%", overloadedLecturers: d.faculty.load.filter((l) => l.over).map((l) => `${l.name} ${l.hours}/${l.max}h`), publishedTimetable: d.published?.name } };
    }
    case "search_students": {
      const q = s("query") ?? "";
      const rows = await prisma.student.findMany({
        where: { AND: [{ OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { studentNo: { contains: q } }, { email: { contains: q } }] }, s("cohortCode") ? { cohort: { code: s("cohortCode")!.toUpperCase() } } : {}] },
        include: { cohort: true, intake: { include: { programme: true } } },
        take: 10,
      });
      return { result: rows.map((r) => ({ studentNo: r.studentNo, name: `${r.firstName} ${r.lastName}`, group: r.cohort.code, programme: r.intake.programme.code, standing: r.standing, link: `/students/${r.id}` })) };
    }
    case "student_record": {
      const st = await prisma.student.findFirst({ where: { studentNo: s("studentNo") }, include: { cohort: true, intake: { include: { programme: true } }, progressions: true, seats: { include: { exam: { include: { module: true } }, room: true } } } });
      if (!st) return { result: { error: "Student not found" } };
      if (user.role === "STUDENT" && user.studentId !== st.id) return { result: { error: "Students can only view their own record" } };
      const rec = await studentRecord(st.id);
      const visible = rec.filter((r) => user.role !== "STUDENT" || r.sheetStatus === "PUBLISHED");
      return {
        result: {
          student: { studentNo: st.studentNo, name: `${st.firstName} ${st.lastName}`, programme: st.intake.programme.name, group: st.cohort.code, semester: st.semester, standing: st.standing, link: `/students/${st.id}` },
          modules: visible.map((r) => ({ term: r.enrolment.term, module: r.enrolment.module.code, name: r.enrolment.module.name, sheet: r.sheetStatus, overall: r.result.overall, grade: r.result.grade, outcome: r.enrolment.status, resits: r.enrolment.resits.map((x) => x.outcome) })),
          progression: st.progressions.map((p) => ({ term: p.term, decision: p.decision, average: p.average, note: p.note })),
          seats: st.seats.map((x) => ({ exam: x.exam.module.code, date: fmtDate(x.exam.date), time: timeRange(x.exam.startMin, x.exam.endMin), room: x.room.code, seat: x.label })),
        },
      };
    }
    case "seat_lookup": {
      if (user.role === "STUDENT") {
        const me = await prisma.student.findUnique({ where: { id: user.studentId ?? "" } });
        if (me && me.studentNo !== s("studentNo")) return { result: { error: "Students can only look up their own seat" } };
      }
      return { result: await nlqExecute("seat_lookup", { student: s("studentNo") }) };
    }
    case "timetable": {
      const type = s("entityType");
      const code = s("code") ?? "";
      const p = type === "cohort" ? { cohort: code.toUpperCase(), entity: code.toUpperCase() } : type === "room" ? { room: code.toUpperCase(), entity: code.toUpperCase() } : type === "module" ? { module: code.toUpperCase(), entity: code.toUpperCase() } : { entity: code };
      const r = await nlqExecute("timetable", { ...p, day: s("day") });
      // enrich with session ids for move_session
      if (r.rows) {
        const tt = await prisma.timetable.findFirst({ where: { term: TERMS.current, status: "PUBLISHED" } });
        const sessions = tt ? await loadSessions(tt.id) : [];
        const d = dayOf(s("day"));
        const filtered = sessions.filter((x) => (type === "cohort" ? x.cohortCode === code.toUpperCase() : type === "room" ? x.roomCode === code.toUpperCase() : type === "module" ? x.moduleCode === code.toUpperCase() : x.lecturerName.toLowerCase().includes(code.toLowerCase().replace(/^dr\.?\s*/, ""))) && (d === null || x.day === d));
        return { result: { summary: r.answer, sessions: filtered.slice(0, 40).map((x) => ({ sessionId: x.id, day: DAY_NAMES[x.day], time: minToTime(x.startMin), module: x.moduleCode, type: x.sessionType, group: x.cohortCode, room: x.roomCode, lecturer: x.lecturerName })), link: r.links?.[0]?.href } };
      }
      return { result: r };
    }
    case "free_rooms":
      return { result: await nlqExecute("room_availability", { day: s("day"), hour: s("hour"), capacity: s("minCapacity"), room: s("roomCode")?.toUpperCase() }) };
    case "lecturer_workload":
      return { result: await nlqExecute("workload", { lecturer: s("name") }) };
    case "module_results":
      return { result: await nlqExecute("module_results", { module: s("moduleCode")?.toUpperCase() }) };
    case "list_result_sheets": {
      const lecturerModules = user.role === "LECTURER" && user.lecturerId ? (await prisma.teachingAssignment.findMany({ where: { lecturerId: user.lecturerId }, select: { moduleId: true } })).map((a) => a.moduleId) : null;
      const sheets = await prisma.resultSheet.findMany({
        where: { ...(s("term") ? { term: s("term") } : {}), ...(s("status") ? { status: s("status")!.toUpperCase() } : {}), ...(s("moduleCode") ? { module: { code: s("moduleCode")!.toUpperCase() } } : {}), ...(lecturerModules ? { moduleId: { in: lecturerModules } } : {}) },
        include: { module: true, cohort: true, marks: { select: { marks: true } } },
        orderBy: [{ term: "desc" }, { status: "asc" }, { module: { code: "asc" } }],
        take: 60,
      });
      return { result: sheets.map((x) => ({ sheetId: x.id, module: x.module.code, name: x.module.name, group: x.cohort.code, term: x.term, status: x.status, completeness: x.marks.length ? Math.round((x.marks.filter((m) => m.marks !== null).length / x.marks.length) * 100) + "%" : "0%", link: `/results/${x.id}` })) };
    }
    case "sheet_details": {
      const id = s("sheetId") ?? (s("moduleCode") ? await resolveSheetId(s("moduleCode")!, s("cohortCode"), s("term")) : null);
      if (!id) return { result: { error: "Sheet not found — give sheetId or moduleCode + cohortCode" } };
      const d = await loadSheet(id);
      if (!d) return { result: { error: "Sheet not found" } };
      return { result: { sheetId: id, module: d.sheet.module.code, group: d.sheet.cohort.code, term: d.sheet.term, status: d.sheet.status, stats: d.stats, validationErrors: d.issues.filter((i) => i.severity === "ERROR").slice(0, 15).map((i) => `${i.studentNo}: ${i.message}`), warnings: d.issues.filter((i) => i.severity === "WARNING").length, anomalies: d.anomalies.map((a) => `${a.severity} ${a.kind}: ${a.message}`), link: `/results/${id}` } };
    }
    case "list_timetables": {
      const tts = await prisma.timetable.findMany({ where: { term: TERMS.current }, orderBy: [{ status: "desc" }, { createdAt: "desc" }], include: { _count: { select: { sessions: true } } } });
      const limits = await lecturerLimits();
      const out = [];
      for (const t of tts) {
        const cs = detectClashes(await loadSessions(t.id), limits);
        out.push({ timetableId: t.id, name: t.name, status: t.status, sessions: t._count.sessions, score: t.score, hardConflicts: cs.filter((c) => c.severity === "HIGH").length, warnings: cs.filter((c) => c.severity !== "HIGH").length, link: `/timetable?tt=${t.id}` });
      }
      return { result: out };
    }
    case "timetable_conflicts": {
      const tt = s("timetableId") ? await prisma.timetable.findUnique({ where: { id: s("timetableId")! } }) : await prisma.timetable.findFirst({ where: { term: TERMS.current, status: "PUBLISHED" } });
      if (!tt) return { result: { error: "Timetable not found" } };
      const cs = detectClashes(await loadSessions(tt.id), await lecturerLimits());
      return { result: { timetable: tt.name, timetableId: tt.id, status: tt.status, total: cs.length, conflicts: cs.slice(0, 25).map((c) => ({ type: clashLabel(c.type), severity: c.severity, when: c.day !== undefined ? `${DAY_NAMES[c.day]} ${minToTime(c.startMin!)}` : undefined, detail: c.message, sessionIds: c.sessionIds })), link: `/timetable?tt=${tt.id}` } };
    }
    case "list_exams": {
      const exams = await prisma.examSession.findMany({
        where: { ...(s("status") ? { status: s("status")!.toUpperCase() } : {}), ...(s("moduleCode") ? { module: { code: s("moduleCode")!.toUpperCase() } } : {}) },
        include: { module: true, cohorts: { include: { cohort: true } }, venues: { include: { room: true } }, _count: { select: { seats: true, invigilations: true } } },
        orderBy: [{ date: "asc" }, { startMin: "asc" }],
        take: 60,
      });
      return { result: exams.map((e) => ({ examId: e.id, module: e.module.code, name: e.module.name, date: e.date, time: timeRange(e.startMin, e.endMin), groups: e.cohorts.map((c) => c.cohort.code), venues: e.venues.map((v) => v.room.code), seated: e._count.seats, invigilators: e._count.invigilations, status: e.status, link: `/exams/${e.id}` })) };
    }
    case "exam_details": {
      const id = await resolveExamId(s("examRef") ?? "");
      if (!id) return { result: { error: "Exam not found" } };
      const e = await prisma.examSession.findUniqueOrThrow({ where: { id }, include: { module: true, cohorts: { include: { cohort: true } }, venues: { include: { room: true } }, invigilations: { include: { lecturer: true, room: true } }, _count: { select: { seats: true } } } });
      return { result: { examId: e.id, module: `${e.module.code} ${e.module.name}`, date: fmtDate(e.date), time: timeRange(e.startMin, e.endMin), term: e.term, status: e.status, groups: e.cohorts.map((c) => c.cohort.code), venues: e.venues.map((v) => `${v.room.code} (${Math.min(v.room.capacity, v.room.rows * v.room.cols)} seats)`), seated: e._count.seats, invigilators: e.invigilations.map((i) => `${i.lecturer.name} — ${i.room.code} (${i.role.toLowerCase()})`), link: `/exams/${e.id}`, printLink: `/exams/${e.id}/print` } };
    }
    case "at_risk_students":
      return { result: await nlqExecute("at_risk", { cohort: s("cohortCode")?.toUpperCase() }) };
    case "room_utilisation":
      return { result: await nlqExecute("room_utilisation", {}) };

    // ── actions ──
    case "generate_timetable": {
      const r = await generateTimetableOption({ name: s("name"), seed: n("seed"), maxLecturerDaily: n("maxLecturerDaily"), maxCohortDaily: n("maxCohortDaily") }, user.id);
      return { result: { ...r, link: `/timetable?tt=${r.timetableId}&report=1` }, navigateTo: `/timetable?tt=${r.timetableId}&report=1`, changed: true };
    }
    case "publish_timetable": {
      const r = await publishTimetableById(s("timetableId")!, user.id);
      return { result: r, navigateTo: r.ok ? `/timetable?tt=${s("timetableId")}` : undefined, changed: r.ok };
    }
    case "auto_resolve_conflicts": {
      const r = await autoResolveTimetable(s("timetableId")!, user.id);
      return { result: r, navigateTo: r.ok ? `/timetable?tt=${s("timetableId")}` : undefined, changed: r.ok };
    }
    case "delete_timetable": {
      const r = await deleteTimetableById(s("timetableId")!, user.id);
      return { result: r, navigateTo: r.ok ? "/timetable" : undefined, changed: r.ok };
    }
    case "move_session": {
      const r = await moveSession(s("sessionId")!, { roomCode: s("roomCode"), day: dayOf(s("day")) ?? undefined, hour: n("hour"), lecturerName: s("lecturerName") }, user.id, Boolean(args.override));
      return { result: r, changed: r.ok };
    }
    case "reassign_teaching": {
      const a = await findAssignment(s("moduleCode")!, s("cohortCode")!, s("sessionType"));
      if (!a) return { result: { error: "No such teaching allocation" } };
      const l = await prisma.lecturer.findFirst({ where: { name: { contains: s("newLecturerName")!.replace(/^dr\.?\s*/i, "") } } });
      if (!l) return { result: { error: `Unknown lecturer ${s("newLecturerName")}` } };
      const r = await reassignAssignment(a.id, l.id, user.id);
      return { result: r, navigateTo: r.ok ? `/faculty/${l.id}` : undefined, changed: r.ok };
    }
    case "allocate_exam_venues":
    case "generate_exam_seating":
    case "assign_invigilators":
    case "prepare_exam": {
      const id = await resolveExamId(s("examRef") ?? "");
      if (!id) return { result: { error: "Exam not found" } };
      const steps: Record<string, unknown> = {};
      if (name === "allocate_exam_venues" || name === "prepare_exam") steps.venues = await allocateVenuesFor(id, "auto", [], user.id);
      if (name === "generate_exam_seating" || name === "prepare_exam") steps.seating = await generateSeatingFor(id, user.id);
      if (name === "assign_invigilators" || name === "prepare_exam") steps.invigilators = await assignInvigilatorsFor(id, user.id);
      return { result: { ...steps, link: `/exams/${id}` }, navigateTo: `/exams/${id}`, changed: true };
    }
    case "create_exam": {
      const [hh, mm] = (s("startTime") ?? "09:00").split(":").map(Number);
      const r = await createExamRecord({ moduleCode: s("moduleCode")!, date: s("date")!, startMin: hh * 60 + (mm || 0), duration: n("durationMin") ?? 120, cohortCodes: (args.cohortCodes as string[]) ?? [] }, user.id);
      return { result: r, navigateTo: r.ok ? `/exams/${r.examId}` : undefined, changed: r.ok };
    }
    case "transition_result_sheet": {
      const id = await resolveSheetId(s("sheetRef")!, s("cohortCode"), s("term"));
      if (!id) return { result: { error: "Sheet not found — give sheetId or moduleCode + cohortCode" } };
      const r = await transitionResultSheet(id, s("op")!, s("note") ?? "", user);
      return { result: { ...r, link: `/results/${id}` }, navigateTo: r.ok ? `/results/${id}` : undefined, changed: r.ok };
    }
    case "open_page": {
      const path = s("path") ?? "/";
      return { result: { ok: path.startsWith("/"), path }, navigateTo: path.startsWith("/") ? path : undefined };
    }
    default: {
      const r = await runAdminTool(name, args, user);
      return r ?? { result: { error: `Tool ${name} not implemented` } };
    }
  }
}
