// Record-management tools: create/update/delete students, staff, rooms, modules,
// groups, enrolments, marks, allocations, sessions, exams and logins.
import type { CurrentUser } from "../auth";
import { DAY_NAMES } from "../constants";
import { resolveExamId } from "../services/exams";
import * as admin from "../services/admin";
import { bool, int, num, str, strArr, type Args, type ToolDef, type ToolOutcome } from "./types";

const dayOf = (v: unknown): number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return v;
  const w = String(v).toLowerCase();
  const i = DAY_NAMES.findIndex((d) => w.startsWith(d.toLowerCase()));
  return i >= 0 ? i : null;
};

export const ADMIN_TOOLS: ToolDef[] = [
  { name: "list_reference", kind: "read", description: "Reference data: programmes, cohorts (student groups), modules, lecturers, rooms, terms or users.", parameters: { type: "object", properties: { kind: { type: "string", enum: ["programmes", "cohorts", "modules", "lecturers", "rooms", "terms", "users"] } }, required: ["kind"] } },
  { name: "create_student", kind: "action", perm: "records:manage", description: "Create a student in a group. Auto-generates the student number and email if omitted, enrols them on the group's current modules and creates a login (password Password123).", parameters: { type: "object", properties: { firstName: str("first name"), lastName: str("last name"), cohortCode: str("group code e.g. L4COG1"), email: str("optional email"), studentNo: str("optional 8-digit number"), semester: int("optional semester"), createLogin: bool("create a login (default true)") }, required: ["firstName", "lastName", "cohortCode"] } },
  { name: "update_student", kind: "action", perm: "records:manage", description: "Update a student's name, email, group, semester or academic standing (GOOD, AT_RISK, PROBATION, WITHDRAWN).", parameters: { type: "object", properties: { studentNo: str("student number"), firstName: str(""), lastName: str(""), email: str(""), cohortCode: str("move to group"), semester: int(""), standing: str("GOOD|AT_RISK|PROBATION|WITHDRAWN") }, required: ["studentNo"] } },
  { name: "delete_student", kind: "action", perm: "records:manage", description: "Permanently delete a student and all their records. Confirm with the user first.", parameters: { type: "object", properties: { studentNo: str("student number") }, required: ["studentNo"] } },
  { name: "enrol_student", kind: "action", perm: "records:manage", description: "Enrol a student on a module for a term (default current term); adds them to the result sheet if one exists.", parameters: { type: "object", properties: { studentNo: str(""), moduleCode: str(""), term: str("e.g. 2026-AUT") }, required: ["studentNo", "moduleCode"] } },
  { name: "unenrol_student", kind: "action", perm: "records:manage", description: "Remove a student's enrolment (and marks) for a module.", parameters: { type: "object", properties: { studentNo: str(""), moduleCode: str(""), term: str("") }, required: ["studentNo", "moduleCode"] } },
  { name: "create_result_sheet", kind: "action", perm: "results:enter", description: "Create a DRAFT result sheet for a module × group × term and enrol all students of the group on it.", parameters: { type: "object", properties: { moduleCode: str(""), cohortCode: str(""), term: str("default current term") }, required: ["moduleCode", "cohortCode"] } },
  { name: "set_marks", kind: "action", perm: "results:enter", description: "Enter or change one student's marks on a DRAFT sheet. Give coursework and/or examination out of 100 (null to clear).", parameters: { type: "object", properties: { studentNo: str(""), moduleCode: str(""), cohortCode: str("optional group"), term: str("optional term"), coursework: num("0–100"), examination: num("0–100") }, required: ["studentNo", "moduleCode"] } },
  { name: "create_lecturer", kind: "action", perm: "records:manage", description: "Add a lecturer (department: Computing, Networking, Multimedia or Business) with a login.", parameters: { type: "object", properties: { name: str(""), department: str(""), email: str("optional"), maxHoursPerWeek: int("default 16"), createLogin: bool("default true") }, required: ["name", "department"] } },
  { name: "update_lecturer", kind: "action", perm: "records:manage", description: "Update a lecturer's name, department, email or weekly hour limit.", parameters: { type: "object", properties: { lecturerName: str("current name"), name: str("new name"), department: str(""), email: str(""), maxHoursPerWeek: int("") }, required: ["lecturerName"] } },
  { name: "upsert_room", kind: "action", perm: "rooms:edit", description: "Create a room, or update an existing one by code (capacity, type LECTURE|LAB|SEMINAR|HALL, exam rows/cols, equipment, active flag).", parameters: { type: "object", properties: { code: str("e.g. LB-107"), name: str(""), building: str(""), type: str(""), capacity: int(""), rows: int("exam seating rows"), cols: int("exam seating columns"), equipment: strArr("equipment list"), active: bool("false to retire the room") }, required: ["code"] } },
  { name: "create_module", kind: "action", perm: "records:manage", description: "Create a module with Coursework + Examination assessments.", parameters: { type: "object", properties: { code: str("e.g. CS4007"), name: str(""), programmeCode: str("BSC-COMP|BSC-CNS|BSC-MMT|BA-BUS"), level: int("4,5 or 6"), semester: int("1 or 2"), credits: int("default 20"), requiresLab: bool(""), courseworkWeight: int("percent, default 50") }, required: ["code", "name", "programmeCode", "level", "semester"] } },
  { name: "create_cohort", kind: "action", perm: "records:manage", description: "Create a student group (cohort) for a programme and intake year.", parameters: { type: "object", properties: { code: str("e.g. L4COG4"), programmeCode: str(""), intakeYear: int("e.g. 2026"), semester: int("default 1"), name: str("") }, required: ["code", "programmeCode", "intakeYear"] } },
  { name: "create_teaching_assignment", kind: "action", perm: "timetable:edit", description: "Assign a lecturer to teach a module for a group (LECTURE/TUTORIAL/LAB, hours per week). Then regenerate the timetable or add sessions.", parameters: { type: "object", properties: { moduleCode: str(""), cohortCode: str(""), lecturerName: str(""), sessionType: str("LECTURE|TUTORIAL|LAB"), hoursPerWeek: int("default 1"), term: str("") }, required: ["moduleCode", "cohortCode", "lecturerName"] } },
  { name: "delete_teaching_assignment", kind: "action", perm: "timetable:edit", description: "Remove a teaching allocation.", parameters: { type: "object", properties: { moduleCode: str(""), cohortCode: str(""), sessionType: str("optional") }, required: ["moduleCode", "cohortCode"] } },
  { name: "add_session", kind: "action", perm: "timetable:edit", description: "Add a timetable session (module, group, room, day, hour) to the published timetable or a given version, with conflict checking.", parameters: { type: "object", properties: { timetableId: str("optional; default published"), moduleCode: str(""), cohortCode: str(""), lecturerName: str("optional; defaults to the allocated lecturer"), roomCode: str(""), day: str("day name"), hour: int("start hour 7–16"), sessionType: str("LECTURE|TUTORIAL|LAB"), override: bool("force despite hard conflicts"), locked: bool("keep when regenerating") }, required: ["moduleCode", "cohortCode", "roomCode", "day", "hour"] } },
  { name: "delete_session", kind: "action", perm: "timetable:edit", description: "Delete a timetable session by id.", parameters: { type: "object", properties: { sessionId: str("") }, required: ["sessionId"] } },
  { name: "delete_exam", kind: "action", perm: "exams:edit", description: "Delete an examination session (and its seating). Confirm first.", parameters: { type: "object", properties: { examRef: str("exam id or module code") }, required: ["examRef"] } },
  { name: "create_login", kind: "action", perm: "users:manage", description: "Create a login for a person (ADMIN, RTE_STAFF, LECTURER or STUDENT), optionally linked to a student number or lecturer.", parameters: { type: "object", properties: { email: str(""), name: str(""), role: str(""), password: str("default Password123"), studentNo: str(""), lecturerName: str("") }, required: ["email", "name", "role"] } },
  { name: "reset_password", kind: "action", perm: "users:manage", description: "Reset a login's password (default Password123).", parameters: { type: "object", properties: { email: str(""), password: str("") }, required: ["email"] } },
];

export async function runAdminTool(name: string, args: Args, user: CurrentUser): Promise<ToolOutcome | null> {
  const s = (k: string) => (args[k] === undefined || args[k] === null || args[k] === "" ? undefined : String(args[k]));
  const n = (k: string) => (args[k] === undefined || args[k] === null || args[k] === "" ? undefined : Number(args[k]));
  const b = (k: string) => (args[k] === undefined || args[k] === null ? undefined : Boolean(args[k]));
  const link = (r: unknown) => (r && typeof r === "object" && "link" in r ? (r as { link?: string }).link : undefined);
  const done = (r: unknown): ToolOutcome => ({ result: r, changed: Boolean((r as { ok?: boolean })?.ok), navigateTo: (r as { ok?: boolean })?.ok ? link(r) : undefined });

  switch (name) {
    case "list_reference":
      return { result: await admin.listReference(s("kind") ?? "") };
    case "create_student":
      return done(await admin.createStudent({ firstName: s("firstName")!, lastName: s("lastName")!, cohortCode: s("cohortCode")!, email: s("email"), studentNo: s("studentNo"), semester: n("semester"), createLogin: b("createLogin") }, user.id));
    case "update_student":
      return done(await admin.updateStudent(s("studentNo")!, { firstName: s("firstName"), lastName: s("lastName"), email: s("email"), cohortCode: s("cohortCode"), semester: n("semester"), standing: s("standing") }, user.id));
    case "delete_student":
      return done(await admin.deleteStudent(s("studentNo")!, user.id));
    case "enrol_student":
      return done(await admin.enrolStudent(s("studentNo")!, s("moduleCode")!, s("term"), user.id));
    case "unenrol_student":
      return done(await admin.unenrolStudent(s("studentNo")!, s("moduleCode")!, s("term"), user.id));
    case "create_result_sheet":
      return done(await admin.createResultSheet(s("moduleCode")!, s("cohortCode")!, s("term"), user.id));
    case "set_marks": {
      const marks: Record<string, number | null> = {};
      if ("coursework" in args) marks.Coursework = args.coursework === null ? null : Number(args.coursework);
      if ("examination" in args) marks.Examination = args.examination === null ? null : Number(args.examination);
      if (!Object.keys(marks).length) return { result: { error: "Give coursework and/or examination" } };
      return done(await admin.setMarks({ studentNo: s("studentNo")!, moduleCode: s("moduleCode")!, cohortCode: s("cohortCode"), term: s("term"), marks }, user.id));
    }
    case "create_lecturer":
      return done(await admin.createLecturer({ name: s("name")!, department: s("department")!, email: s("email"), maxHoursPerWeek: n("maxHoursPerWeek"), createLogin: b("createLogin") }, user.id));
    case "update_lecturer":
      return done(await admin.updateLecturer(s("lecturerName")!, { name: s("name"), department: s("department"), email: s("email"), maxHoursPerWeek: n("maxHoursPerWeek") }, user.id));
    case "upsert_room":
      return done(await admin.upsertRoom({ code: s("code")!, name: s("name"), building: s("building"), type: s("type"), capacity: n("capacity"), rows: n("rows"), cols: n("cols"), equipment: Array.isArray(args.equipment) ? (args.equipment as string[]) : undefined, active: b("active") }, user.id));
    case "create_module":
      return done(await admin.createModule({ code: s("code")!, name: s("name")!, programmeCode: s("programmeCode")!, level: n("level") ?? 4, semester: n("semester") ?? 1, credits: n("credits"), requiresLab: b("requiresLab"), courseworkWeight: n("courseworkWeight") }, user.id));
    case "create_cohort":
      return done(await admin.createCohort({ code: s("code")!, programmeCode: s("programmeCode")!, intakeYear: n("intakeYear") ?? new Date().getFullYear(), semester: n("semester"), name: s("name") }, user.id));
    case "create_teaching_assignment":
      return done(await admin.createTeachingAssignment({ moduleCode: s("moduleCode")!, cohortCode: s("cohortCode")!, lecturerName: s("lecturerName")!, sessionType: s("sessionType"), hoursPerWeek: n("hoursPerWeek"), term: s("term") }, user.id));
    case "delete_teaching_assignment":
      return done(await admin.deleteTeachingAssignment(s("moduleCode")!, s("cohortCode")!, s("sessionType"), user.id));
    case "add_session": {
      const day = dayOf(args.day);
      if (day === null) return { result: { error: "day must be a day name (Sun–Fri)" } };
      return done(await admin.addSession({ timetableId: s("timetableId"), moduleCode: s("moduleCode")!, cohortCode: s("cohortCode")!, lecturerName: s("lecturerName"), roomCode: s("roomCode")!, day, hour: n("hour") ?? 9, sessionType: s("sessionType"), override: b("override"), locked: b("locked") }, user.id));
    }
    case "delete_session":
      return done(await admin.deleteSessionById(s("sessionId")!, user.id));
    case "delete_exam": {
      const id = await resolveExamId(s("examRef") ?? "");
      if (!id) return { result: { error: "Exam not found" } };
      const r = await admin.deleteExamById(id, user.id);
      return { result: r, changed: r.ok, navigateTo: r.ok ? "/exams" : undefined };
    }
    case "create_login":
      return done(await admin.createLogin({ email: s("email")!, name: s("name")!, role: s("role")!, password: s("password"), studentNo: s("studentNo"), lecturerName: s("lecturerName") }, user.id));
    case "reset_password":
      return done(await admin.resetPassword(s("email")!, s("password"), user.id));
    default:
      return null;
  }
}
