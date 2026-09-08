// Record-management services (students, staff, rooms, modules, groups, enrolments, marks,
// teaching allocations, sessions). Shared by the agent tools; every write is audited.
import { prisma } from "../prisma";
import { audit } from "../audit";
import { TERMS } from "../constants";
import { hashPassword } from "../password";
import { saveSessionRecord } from "./timetable";

const fail = (error: string) => ({ ok: false as const, error });

export const DEFAULT_PASSWORD = "Password123";

async function findCohort(code?: string) {
  return code ? prisma.cohort.findFirst({ where: { code: code.toUpperCase() }, include: { intake: true } }) : null;
}
async function findModule(code?: string) {
  return code ? prisma.module.findFirst({ where: { code: code.toUpperCase() } }) : null;
}
export async function findLecturerByName(name?: string) {
  if (!name) return null;
  const clean = name.replace(/^dr\.?\s*/i, "").trim();
  return prisma.lecturer.findFirst({ where: { name: { contains: clean } } });
}
async function findStudent(studentNo?: string) {
  return studentNo ? prisma.student.findFirst({ where: { studentNo }, include: { cohort: true } }) : null;
}

// ── reference lists ──
export async function listReference(kind: string) {
  switch (kind) {
    case "programmes":
      return prisma.programme.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { modules: true, intakes: true } } } });
    case "cohorts":
      return (await prisma.cohort.findMany({ orderBy: { code: "asc" }, include: { intake: { include: { programme: true } }, _count: { select: { students: true } } } })).map((c) => ({ code: c.code, name: c.name, programme: c.intake.programme.code, intake: c.intake.code, semester: c.semester, students: c._count.students }));
    case "modules":
      return (await prisma.module.findMany({ orderBy: { code: "asc" }, include: { programme: true } })).map((m) => ({ code: m.code, name: m.name, level: m.level, semester: m.semester, credits: m.credits, programme: m.programme.code, requiresLab: m.requiresLab }));
    case "lecturers":
      return (await prisma.lecturer.findMany({ orderBy: { name: "asc" } })).map((l) => ({ staffNo: l.staffNo, name: l.name, email: l.email, department: l.department, maxHoursPerWeek: l.maxHoursPerWeek }));
    case "rooms":
      return (await prisma.room.findMany({ orderBy: { code: "asc" } })).map((r) => ({ code: r.code, name: r.name, building: r.building, type: r.type, capacity: r.capacity, examGrid: `${r.rows}x${r.cols}`, active: r.active, equipment: JSON.parse(r.equipment) }));
    case "terms":
      return { previous: TERMS.previous, processing: TERMS.processing, current: TERMS.current, all: ["2024-AUT", "2025-SPR", "2025-AUT", "2026-SPR", "2026-AUT"] };
    case "users":
      return (await prisma.user.findMany({ orderBy: { role: "asc" }, take: 60, select: { email: true, name: true, role: true } }));
    default:
      return fail("kind must be programmes|cohorts|modules|lecturers|rooms|terms|users");
  }
}

// ── students ──
export async function createStudent(input: { firstName: string; lastName: string; cohortCode: string; email?: string; studentNo?: string; semester?: number; createLogin?: boolean }, userId: string) {
  const cohort = await findCohort(input.cohortCode);
  if (!cohort) return fail(`Unknown group ${input.cohortCode}`);
  if (!input.firstName?.trim() || !input.lastName?.trim()) return fail("First and last name are required");
  const year = cohort.intake.year;
  let studentNo = input.studentNo?.trim();
  if (!studentNo) {
    const last = await prisma.student.findFirst({ where: { studentNo: { startsWith: String(year) } }, orderBy: { studentNo: "desc" } });
    const next = last ? Number(last.studentNo.slice(4)) + 1 : 1;
    studentNo = `${year}${String(next).padStart(4, "0")}`;
  }
  if (await prisma.student.findUnique({ where: { studentNo } })) return fail(`Student number ${studentNo} already exists`);
  let email = input.email?.trim().toLowerCase() || `${input.firstName}.${input.lastName}${studentNo.slice(-4)}@islingtoncollege.edu.np`.toLowerCase().replace(/\s+/g, "");
  if (await prisma.student.findUnique({ where: { email } })) email = `${studentNo}@islingtoncollege.edu.np`;
  const student = await prisma.student.create({ data: { studentNo, firstName: input.firstName.trim(), lastName: input.lastName.trim(), email, intakeId: cohort.intakeId, cohortId: cohort.id, semester: input.semester ?? cohort.semester } });
  // enrol on the group's current-term modules
  const assignments = await prisma.teachingAssignment.findMany({ where: { cohortId: cohort.id, term: TERMS.current }, distinct: ["moduleId"], select: { moduleId: true } });
  for (const a of assignments) await enrol(student.id, a.moduleId, TERMS.current, cohort.id);
  await prisma.cohort.update({ where: { id: cohort.id }, data: { size: { increment: 1 } } });
  let login: string | undefined;
  if (input.createLogin !== false && !(await prisma.user.findUnique({ where: { email } }))) {
    await prisma.user.create({ data: { email, name: `${student.firstName} ${student.lastName}`, passwordHash: hashPassword(DEFAULT_PASSWORD), role: "STUDENT", studentId: student.id } });
    login = `${email} / ${DEFAULT_PASSWORD}`;
  }
  await audit(userId, "STUDENT_CREATED", "Student", student.id, { studentNo, cohort: cohort.code, email, modules: assignments.length });
  return { ok: true as const, studentNo, name: `${student.firstName} ${student.lastName}`, email, group: cohort.code, enrolledModules: assignments.length, login, link: `/students/${student.id}` };
}

export async function updateStudent(studentNo: string, patch: { firstName?: string; lastName?: string; email?: string; cohortCode?: string; standing?: string; semester?: number }, userId: string) {
  const s = await findStudent(studentNo);
  if (!s) return fail(`Student ${studentNo} not found`);
  const data: Record<string, unknown> = {};
  if (patch.firstName) data.firstName = patch.firstName.trim();
  if (patch.lastName) data.lastName = patch.lastName.trim();
  if (patch.email) data.email = patch.email.trim().toLowerCase();
  if (patch.semester) data.semester = patch.semester;
  if (patch.standing) {
    const st = patch.standing.toUpperCase().replace(/[\s-]/g, "_");
    if (!["GOOD", "AT_RISK", "PROBATION", "WITHDRAWN"].includes(st)) return fail("standing must be GOOD, AT_RISK, PROBATION or WITHDRAWN");
    data.standing = st;
  }
  if (patch.cohortCode) {
    const c = await findCohort(patch.cohortCode);
    if (!c) return fail(`Unknown group ${patch.cohortCode}`);
    data.cohortId = c.id;
    data.intakeId = c.intakeId;
    await prisma.cohort.update({ where: { id: s.cohortId }, data: { size: { decrement: 1 } } });
    await prisma.cohort.update({ where: { id: c.id }, data: { size: { increment: 1 } } });
  }
  if (!Object.keys(data).length) return fail("Nothing to update");
  const updated = await prisma.student.update({ where: { id: s.id }, data, include: { cohort: true } });
  await audit(userId, "STUDENT_UPDATED", "Student", s.id, { studentNo, patch: data });
  return { ok: true as const, studentNo, name: `${updated.firstName} ${updated.lastName}`, group: updated.cohort.code, standing: updated.standing, link: `/students/${s.id}` };
}

export async function deleteStudent(studentNo: string, userId: string) {
  const s = await findStudent(studentNo);
  if (!s) return fail(`Student ${studentNo} not found`);
  await prisma.$transaction([
    prisma.seatAllocation.deleteMany({ where: { studentId: s.id } }),
    prisma.mark.deleteMany({ where: { enrollment: { studentId: s.id } } }),
    prisma.resit.deleteMany({ where: { enrollment: { studentId: s.id } } }),
    prisma.moduleEnrollment.deleteMany({ where: { studentId: s.id } }),
    prisma.progressionRecord.deleteMany({ where: { studentId: s.id } }),
    prisma.user.deleteMany({ where: { studentId: s.id } }),
    prisma.student.delete({ where: { id: s.id } }),
    prisma.cohort.update({ where: { id: s.cohortId }, data: { size: { decrement: 1 } } }),
  ]);
  await audit(userId, "STUDENT_DELETED", "Student", s.id, { studentNo, name: `${s.firstName} ${s.lastName}` });
  return { ok: true as const, studentNo, name: `${s.firstName} ${s.lastName}` };
}

// ── enrolments & marks ──
async function enrol(studentId: string, moduleId: string, term: string, cohortId: string) {
  const existing = await prisma.moduleEnrollment.findFirst({ where: { studentId, moduleId, term } });
  const e = existing ?? (await prisma.moduleEnrollment.create({ data: { studentId, moduleId, term, attempt: 1, status: "ACTIVE" } }));
  const sheet = await prisma.resultSheet.findFirst({ where: { moduleId, cohortId, term }, include: { module: { include: { assessments: true } } } });
  if (sheet) {
    for (const a of sheet.module.assessments) {
      await prisma.mark.upsert({ where: { sheetId_enrollmentId_assessmentId: { sheetId: sheet.id, enrollmentId: e.id, assessmentId: a.id } }, update: {}, create: { sheetId: sheet.id, enrollmentId: e.id, assessmentId: a.id, marks: null } });
    }
  }
  return e;
}

export async function enrolStudent(studentNo: string, moduleCode: string, term: string | undefined, userId: string) {
  const s = await findStudent(studentNo);
  const m = await findModule(moduleCode);
  if (!s) return fail(`Student ${studentNo} not found`);
  if (!m) return fail(`Unknown module ${moduleCode}`);
  const t = term || TERMS.current;
  const e = await enrol(s.id, m.id, t, s.cohortId);
  await audit(userId, "STUDENT_ENROLLED", "ModuleEnrollment", e.id, { studentNo, module: m.code, term: t });
  return { ok: true as const, studentNo, module: m.code, term: t, link: `/students/${s.id}` };
}

export async function unenrolStudent(studentNo: string, moduleCode: string, term: string | undefined, userId: string) {
  const s = await findStudent(studentNo);
  const m = await findModule(moduleCode);
  if (!s || !m) return fail("Student or module not found");
  const e = await prisma.moduleEnrollment.findFirst({ where: { studentId: s.id, moduleId: m.id, ...(term ? { term } : {}) }, orderBy: { term: "desc" } });
  if (!e) return fail("No such enrolment");
  await prisma.$transaction([prisma.mark.deleteMany({ where: { enrollmentId: e.id } }), prisma.resit.deleteMany({ where: { enrollmentId: e.id } }), prisma.moduleEnrollment.delete({ where: { id: e.id } })]);
  await audit(userId, "STUDENT_UNENROLLED", "ModuleEnrollment", e.id, { studentNo, module: m.code, term: e.term });
  return { ok: true as const, studentNo, module: m.code, term: e.term };
}

export async function createResultSheet(moduleCode: string, cohortCode: string, term: string | undefined, userId: string) {
  const m = await findModule(moduleCode);
  const c = await findCohort(cohortCode);
  if (!m) return fail(`Unknown module ${moduleCode}`);
  if (!c) return fail(`Unknown group ${cohortCode}`);
  const t = term || TERMS.current;
  if (await prisma.resultSheet.findFirst({ where: { moduleId: m.id, cohortId: c.id, term: t } })) return fail("That sheet already exists");
  const sheet = await prisma.resultSheet.create({ data: { moduleId: m.id, cohortId: c.id, term: t, status: "DRAFT" } });
  const students = await prisma.student.findMany({ where: { cohortId: c.id } });
  for (const s of students) await enrol(s.id, m.id, t, c.id);
  await audit(userId, "RESULT_SHEET_CREATED", "ResultSheet", sheet.id, { module: m.code, cohort: c.code, term: t, students: students.length });
  return { ok: true as const, sheetId: sheet.id, module: m.code, group: c.code, term: t, students: students.length, link: `/results/${sheet.id}` };
}

export async function setMarks(input: { studentNo: string; moduleCode: string; cohortCode?: string; term?: string; marks: Record<string, number | null> }, userId: string) {
  const s = await findStudent(input.studentNo);
  const m = await findModule(input.moduleCode);
  if (!s) return fail(`Student ${input.studentNo} not found`);
  if (!m) return fail(`Unknown module ${input.moduleCode}`);
  const sheet = await prisma.resultSheet.findFirst({
    where: { moduleId: m.id, cohortId: input.cohortCode ? (await findCohort(input.cohortCode))?.id : s.cohortId, ...(input.term ? { term: input.term } : {}) },
    orderBy: { term: "desc" },
    include: { module: { include: { assessments: true } } },
  });
  if (!sheet) return fail("No result sheet for that module/group — create one first");
  if (sheet.status !== "DRAFT") return fail(`Sheet is ${sheet.status}; only DRAFT sheets accept marks (reopen it first)`);
  const e = await enrol(s.id, m.id, sheet.term, sheet.cohortId);
  const written: string[] = [];
  for (const [name, value] of Object.entries(input.marks)) {
    const a = sheet.module.assessments.find((x) => x.name.toLowerCase().startsWith(name.toLowerCase().slice(0, 4)));
    if (!a) return fail(`Unknown assessment "${name}" — use ${sheet.module.assessments.map((x) => x.name).join(" or ")}`);
    if (value !== null && (value < 0 || value > a.maxMarks)) return fail(`${a.name} must be 0–${a.maxMarks}`);
    await prisma.mark.upsert({ where: { sheetId_enrollmentId_assessmentId: { sheetId: sheet.id, enrollmentId: e.id, assessmentId: a.id } }, update: { marks: value }, create: { sheetId: sheet.id, enrollmentId: e.id, assessmentId: a.id, marks: value } });
    written.push(`${a.name}=${value ?? "blank"}`);
  }
  await audit(userId, "MARKS_SAVED", "ResultSheet", sheet.id, { studentNo: s.studentNo, module: m.code, written });
  return { ok: true as const, studentNo: s.studentNo, module: m.code, term: sheet.term, written, link: `/results/${sheet.id}` };
}

// ── staff ──
export async function createLecturer(input: { name: string; department: string; email?: string; maxHoursPerWeek?: number; createLogin?: boolean }, userId: string) {
  if (!input.name?.trim() || !input.department?.trim()) return fail("Name and department are required");
  const count = await prisma.lecturer.count();
  const staffNo = `STF${1001 + count + Math.floor(Math.random() * 50)}`;
  const email = input.email?.trim().toLowerCase() || `${input.name.toLowerCase().replace(/dr\.?\s*/, "").replace(/[^a-z ]/g, "").trim().replace(/\s+/g, ".")}@islington.edu.np`;
  if (await prisma.lecturer.findUnique({ where: { email } })) return fail(`A lecturer with email ${email} already exists`);
  const l = await prisma.lecturer.create({ data: { staffNo, name: input.name.trim(), email, department: input.department.trim(), maxHoursPerWeek: input.maxHoursPerWeek ?? 16 } });
  let login: string | undefined;
  if (input.createLogin !== false && !(await prisma.user.findUnique({ where: { email } }))) {
    await prisma.user.create({ data: { email, name: l.name, passwordHash: hashPassword(DEFAULT_PASSWORD), role: "LECTURER", lecturerId: l.id } });
    login = `${email} / ${DEFAULT_PASSWORD}`;
  }
  await audit(userId, "LECTURER_CREATED", "Lecturer", l.id, { name: l.name, department: l.department });
  return { ok: true as const, staffNo, name: l.name, email, department: l.department, login, link: `/faculty/${l.id}` };
}

export async function updateLecturer(name: string, patch: { name?: string; department?: string; email?: string; maxHoursPerWeek?: number }, userId: string) {
  const l = await findLecturerByName(name);
  if (!l) return fail(`Lecturer ${name} not found`);
  const data: Record<string, unknown> = {};
  if (patch.name) data.name = patch.name.trim();
  if (patch.department) data.department = patch.department.trim();
  if (patch.email) data.email = patch.email.trim().toLowerCase();
  if (patch.maxHoursPerWeek) data.maxHoursPerWeek = patch.maxHoursPerWeek;
  if (!Object.keys(data).length) return fail("Nothing to update");
  const u = await prisma.lecturer.update({ where: { id: l.id }, data });
  await audit(userId, "LECTURER_UPDATED", "Lecturer", l.id, data);
  return { ok: true as const, name: u.name, department: u.department, maxHoursPerWeek: u.maxHoursPerWeek, link: `/faculty/${l.id}` };
}

// ── rooms ──
export async function upsertRoom(input: { code: string; name?: string; building?: string; type?: string; capacity?: number; rows?: number; cols?: number; equipment?: string[]; active?: boolean }, userId: string) {
  const code = input.code?.trim().toUpperCase();
  if (!code) return fail("Room code is required");
  const existing = await prisma.room.findUnique({ where: { code } });
  if (!existing && (!input.name || !input.capacity)) return fail("New rooms need a name and capacity");
  const type = input.type?.toUpperCase();
  if (type && !["LECTURE", "LAB", "SEMINAR", "HALL"].includes(type)) return fail("type must be LECTURE, LAB, SEMINAR or HALL");
  const data = {
    ...(input.name ? { name: input.name } : {}),
    ...(input.building ? { building: input.building } : {}),
    ...(type ? { type } : {}),
    ...(input.capacity ? { capacity: input.capacity } : {}),
    ...(input.rows ? { rows: input.rows } : {}),
    ...(input.cols ? { cols: input.cols } : {}),
    ...(input.equipment ? { equipment: JSON.stringify(input.equipment) } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  };
  const room = existing
    ? await prisma.room.update({ where: { id: existing.id }, data })
    : await prisma.room.create({ data: { code, name: input.name!, building: input.building ?? "London Block", type: type ?? "LECTURE", capacity: input.capacity!, rows: input.rows ?? 6, cols: input.cols ?? 8, equipment: JSON.stringify(input.equipment ?? []), active: input.active ?? true } });
  await audit(userId, existing ? "ROOM_UPDATED" : "ROOM_CREATED", "Room", room.id, data);
  return { ok: true as const, created: !existing, code: room.code, name: room.name, type: room.type, capacity: room.capacity, active: room.active, link: `/rooms/${room.id}` };
}

// ── curriculum ──
export async function createModule(input: { code: string; name: string; programmeCode: string; level: number; semester: number; credits?: number; requiresLab?: boolean; courseworkWeight?: number }, userId: string) {
  const code = input.code?.trim().toUpperCase();
  const prog = await prisma.programme.findFirst({ where: { code: input.programmeCode?.toUpperCase() } });
  if (!code || !input.name) return fail("Module code and name are required");
  if (!prog) return fail(`Unknown programme ${input.programmeCode} (use list_reference programmes)`);
  if (await prisma.module.findUnique({ where: { code } })) return fail(`Module ${code} already exists`);
  const cw = input.courseworkWeight ?? 50;
  const m = await prisma.module.create({
    data: { code, name: input.name, programmeId: prog.id, level: input.level, semester: input.semester, credits: input.credits ?? 20, requiresLab: input.requiresLab ?? false, assessments: { create: [{ name: "Coursework", weight: cw, maxMarks: 100 }, { name: "Examination", weight: 100 - cw, maxMarks: 100 }] } },
  });
  await audit(userId, "MODULE_CREATED", "Module", m.id, { code, name: input.name, programme: prog.code });
  return { ok: true as const, code: m.code, name: m.name, programme: prog.code, level: m.level, semester: m.semester, assessments: `Coursework ${cw}% + Examination ${100 - cw}%` };
}

export async function createCohort(input: { code: string; programmeCode: string; intakeYear: number; semester?: number; name?: string }, userId: string) {
  const code = input.code?.trim().toUpperCase();
  const prog = await prisma.programme.findFirst({ where: { code: input.programmeCode?.toUpperCase() } });
  if (!code) return fail("Group code is required");
  if (!prog) return fail(`Unknown programme ${input.programmeCode}`);
  if (await prisma.cohort.findUnique({ where: { code } })) return fail(`Group ${code} already exists`);
  const intakeCode = `${input.intakeYear}-SEP-${prog.code}`;
  const intake = (await prisma.intake.findUnique({ where: { code: intakeCode } })) ?? (await prisma.intake.create({ data: { code: intakeCode, year: input.intakeYear, term: "SEP", programmeId: prog.id } }));
  const c = await prisma.cohort.create({ data: { code, name: input.name ?? `${code} — ${prog.code}`, intakeId: intake.id, semester: input.semester ?? 1, size: 0 } });
  await audit(userId, "COHORT_CREATED", "Cohort", c.id, { code, programme: prog.code, intake: intakeCode });
  return { ok: true as const, code: c.code, programme: prog.code, intake: intakeCode, semester: c.semester };
}

export async function createTeachingAssignment(input: { moduleCode: string; cohortCode: string; lecturerName: string; sessionType?: string; hoursPerWeek?: number; term?: string }, userId: string) {
  const m = await findModule(input.moduleCode);
  const c = await findCohort(input.cohortCode);
  const l = await findLecturerByName(input.lecturerName);
  if (!m) return fail(`Unknown module ${input.moduleCode}`);
  if (!c) return fail(`Unknown group ${input.cohortCode}`);
  if (!l) return fail(`Unknown lecturer ${input.lecturerName}`);
  const sessionType = (input.sessionType ?? "LECTURE").toUpperCase();
  if (!["LECTURE", "TUTORIAL", "LAB"].includes(sessionType)) return fail("sessionType must be LECTURE, TUTORIAL or LAB");
  const term = input.term ?? TERMS.current;
  const a = await prisma.teachingAssignment.upsert({
    where: { moduleId_cohortId_sessionType_term: { moduleId: m.id, cohortId: c.id, sessionType, term } },
    update: { lecturerId: l.id, hoursPerWeek: input.hoursPerWeek ?? 1 },
    create: { moduleId: m.id, cohortId: c.id, lecturerId: l.id, sessionType, hoursPerWeek: input.hoursPerWeek ?? 1, term },
  });
  await audit(userId, "ALLOCATION_CREATED", "TeachingAssignment", a.id, { module: m.code, cohort: c.code, lecturer: l.name, sessionType, hoursPerWeek: a.hoursPerWeek });
  return { ok: true as const, module: m.code, group: c.code, lecturer: l.name, sessionType, hoursPerWeek: a.hoursPerWeek, term, note: "Run generate_timetable (or add_session) to place it on the timetable" };
}

export async function deleteTeachingAssignment(moduleCode: string, cohortCode: string, sessionType: string | undefined, userId: string) {
  const m = await findModule(moduleCode);
  const c = await findCohort(cohortCode);
  if (!m || !c) return fail("Module or group not found");
  const res = await prisma.teachingAssignment.deleteMany({ where: { moduleId: m.id, cohortId: c.id, ...(sessionType ? { sessionType: sessionType.toUpperCase() } : {}) } });
  await audit(userId, "ALLOCATION_DELETED", "TeachingAssignment", null, { module: m.code, cohort: c.code, sessionType, removed: res.count });
  return { ok: true as const, removed: res.count };
}

// ── timetable sessions ──
export async function addSession(input: { timetableId?: string; moduleCode: string; cohortCode: string; lecturerName?: string; roomCode: string; day: number; hour: number; sessionType?: string; override?: boolean; locked?: boolean }, userId: string) {
  const tt = input.timetableId ? await prisma.timetable.findUnique({ where: { id: input.timetableId } }) : await prisma.timetable.findFirst({ where: { term: TERMS.current, status: "PUBLISHED" } });
  if (!tt) return fail("Timetable not found");
  const m = await findModule(input.moduleCode);
  const c = await findCohort(input.cohortCode);
  const r = await prisma.room.findFirst({ where: { code: input.roomCode?.toUpperCase() } });
  const slot = await prisma.timeSlot.findFirst({ where: { day: input.day, startMin: input.hour * 60 } });
  if (!m) return fail(`Unknown module ${input.moduleCode}`);
  if (!c) return fail(`Unknown group ${input.cohortCode}`);
  if (!r) return fail(`Unknown room ${input.roomCode}`);
  if (!slot) return fail("No teaching slot at that day/hour (Sun–Fri, 07:00–16:00 starts)");
  const sessionType = (input.sessionType ?? "LECTURE").toUpperCase();
  let lecturer = await findLecturerByName(input.lecturerName);
  if (!lecturer) {
    const a = await prisma.teachingAssignment.findFirst({ where: { moduleId: m.id, cohortId: c.id }, include: { lecturer: true }, orderBy: { sessionType: "asc" } });
    lecturer = a?.lecturer ?? null;
  }
  if (!lecturer) return fail("Lecturer not found and no teaching allocation exists for that module/group — give lecturerName");
  const res = await saveSessionRecord({ timetableId: tt.id, moduleId: m.id, cohortId: c.id, lecturerId: lecturer.id, roomId: r.id, slotId: slot.id, sessionType }, { override: Boolean(input.override), locked: Boolean(input.locked) }, userId);
  if (!res.ok) return res;
  return { ok: true as const, sessionId: res.id, timetable: tt.name, module: m.code, group: c.code, lecturer: lecturer.name, room: r.code, sessionType, warnings: res.clashes, link: `/timetable?tt=${tt.id}` };
}

export async function deleteSessionById(sessionId: string, userId: string) {
  const s = await prisma.timetableSession.findUnique({ where: { id: sessionId }, include: { module: true, cohort: true } });
  if (!s) return fail("Session not found");
  await prisma.timetableSession.delete({ where: { id: sessionId } });
  await audit(userId, "SESSION_DELETED", "TimetableSession", sessionId, { module: s.module.code, cohort: s.cohort.code });
  return { ok: true as const, module: s.module.code, group: s.cohort.code, link: `/timetable?tt=${s.timetableId}` };
}

export async function deleteExamById(examId: string, userId: string) {
  const e = await prisma.examSession.findUnique({ where: { id: examId }, include: { module: true } });
  if (!e) return fail("Exam not found");
  await prisma.examSession.delete({ where: { id: examId } });
  await audit(userId, "EXAM_DELETED", "ExamSession", examId, { module: e.module.code, date: e.date });
  return { ok: true as const, module: e.module.code, date: e.date };
}

// ── users ──
export async function createLogin(input: { email: string; name: string; role: string; password?: string; studentNo?: string; lecturerName?: string }, userId: string) {
  const role = input.role?.toUpperCase();
  if (!["ADMIN", "RTE_STAFF", "LECTURER", "STUDENT"].includes(role)) return fail("role must be ADMIN, RTE_STAFF, LECTURER or STUDENT");
  const email = input.email?.trim().toLowerCase();
  if (!email) return fail("Email is required");
  if (await prisma.user.findUnique({ where: { email } })) return fail(`Login ${email} already exists`);
  const student = input.studentNo ? await findStudent(input.studentNo) : null;
  const lecturer = input.lecturerName ? await findLecturerByName(input.lecturerName) : null;
  const password = input.password || DEFAULT_PASSWORD;
  const u = await prisma.user.create({ data: { email, name: input.name, role, passwordHash: hashPassword(password), studentId: student?.id, lecturerId: lecturer?.id } });
  await audit(userId, "USER_CREATED", "User", u.id, { email, role });
  return { ok: true as const, email, role, password, linkedTo: student ? `student ${student.studentNo}` : lecturer ? `lecturer ${lecturer.name}` : "nobody" };
}

export async function resetPassword(email: string, password: string | undefined, userId: string) {
  const u = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!u) return fail("Login not found");
  const pw = password || DEFAULT_PASSWORD;
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: hashPassword(pw) } });
  await audit(userId, "PASSWORD_RESET", "User", u.id, { email: u.email });
  return { ok: true as const, email: u.email, password: pw };
}
