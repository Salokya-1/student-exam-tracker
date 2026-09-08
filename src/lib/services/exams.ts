// Examination services — venue allocation, seating, invigilation (shared by actions + agent).
import { prisma } from "../prisma";
import { audit } from "../audit";
import { TERMS } from "../constants";
import { generateSeating, suggestVenues, type SeatVenue } from "../engine/seating";
import { allocateInvigilators } from "../engine/invigilation";

/** Students sitting an exam = students of its cohorts, except resit exams where only failed/pending students sit. */
export async function examCandidates(examId: string) {
  const exam = await prisma.examSession.findUniqueOrThrow({ where: { id: examId }, include: { cohorts: true, module: true } });
  const students = await prisma.student.findMany({ where: { cohortId: { in: exam.cohorts.map((c) => c.cohortId) } }, include: { cohort: true }, orderBy: { studentNo: "asc" } });
  if (exam.term !== TERMS.current) {
    const resitting = await prisma.moduleEnrollment.findMany({ where: { moduleId: exam.moduleId, studentId: { in: students.map((s) => s.id) }, OR: [{ status: "FAILED" }, { resits: { some: { outcome: "PENDING" } } }] }, select: { studentId: true } });
    const ids = new Set(resitting.map((r) => r.studentId));
    const filtered = students.filter((s) => ids.has(s.id));
    if (filtered.length) return { exam, students: filtered };
  }
  return { exam, students };
}

async function sittingExams(examId: string) {
  const exam = await prisma.examSession.findUniqueOrThrow({ where: { id: examId } });
  return prisma.examSession.findMany({ where: { date: exam.date, startMin: exam.startMin }, include: { module: true, venues: { include: { room: true } } }, orderBy: { module: { code: "asc" } } });
}

export async function resolveExamId(ref: string): Promise<string | null> {
  const byId = await prisma.examSession.findUnique({ where: { id: ref } });
  if (byId) return byId.id;
  const byCode = await prisma.examSession.findFirst({ where: { module: { code: ref.toUpperCase() } }, orderBy: { date: "asc" } });
  return byCode?.id ?? null;
}

export async function allocateVenuesFor(examId: string, mode: "auto" | "manual", roomIds: string[], userId: string) {
  const { students } = await examCandidates(examId);
  const exam = await prisma.examSession.findUniqueOrThrow({ where: { id: examId } });
  let ids = roomIds;
  if (mode === "auto") {
    const rooms = await prisma.room.findMany({ where: { active: true, type: { in: ["HALL", "LECTURE"] } } });
    const busy = await prisma.examVenue.findMany({ where: { exam: { date: exam.date, startMin: exam.startMin, NOT: { id: examId } } }, select: { roomId: true } });
    const venues: SeatVenue[] = rooms.map((r) => ({ roomId: r.id, code: r.code, rows: r.rows, cols: r.cols, capacity: Math.min(r.capacity, r.rows * r.cols) }));
    ids = suggestVenues(venues, students.length, new Set(busy.map((b) => b.roomId))).map((v) => v.roomId);
  }
  if (!ids.length) return { ok: false as const, error: "No venue selected / no free venue large enough" };
  await prisma.$transaction([
    prisma.seatAllocation.deleteMany({ where: { examId } }),
    prisma.invigilation.deleteMany({ where: { examId } }),
    prisma.examVenue.deleteMany({ where: { examId } }),
    prisma.examVenue.createMany({ data: ids.map((roomId) => ({ examId, roomId })) }),
    prisma.examSession.update({ where: { id: examId }, data: { status: "VENUES_ALLOCATED" } }),
  ]);
  const rooms = await prisma.room.findMany({ where: { id: { in: ids } } });
  const capacity = rooms.reduce((a, r) => a + Math.min(r.capacity, r.rows * r.cols), 0);
  await audit(userId, mode === "auto" ? "VENUES_AUTO_ALLOCATED" : "VENUES_SET", "ExamSession", examId, { rooms: rooms.map((r) => r.code), students: students.length, capacity });
  return { ok: true as const, rooms: rooms.map((r) => r.code), students: students.length, capacity };
}

/** Seats every exam in the sitting together so papers are interleaved across shared venues. */
export async function generateSeatingFor(examId: string, userId: string) {
  const exams = await sittingExams(examId);
  const venueMap = new Map<string, SeatVenue>();
  for (const e of exams) for (const v of e.venues) venueMap.set(v.roomId, { roomId: v.roomId, code: v.room.code, rows: v.room.rows, cols: v.room.cols, capacity: Math.min(v.room.capacity, v.room.rows * v.room.cols) });
  if (!venueMap.size) return { ok: false as const, error: "Allocate venues first" };
  const seatExams = [];
  for (const e of exams) {
    if (!e.venues.length) continue;
    const { students } = await examCandidates(e.id);
    seatExams.push({ examId: e.id, moduleCode: e.module.code, students: students.map((s) => ({ id: s.id, studentNo: s.studentNo, name: `${s.firstName} ${s.lastName}`, cohortCode: s.cohort.code })) });
  }
  const plan = generateSeating(seatExams, [...venueMap.values()]);
  const ids = seatExams.map((e) => e.examId);
  await prisma.$transaction([
    prisma.seatAllocation.deleteMany({ where: { examId: { in: ids } } }),
    ...plan.assignments.map((a) => prisma.seatAllocation.create({ data: { examId: a.examId, roomId: a.roomId, studentId: a.studentId, seatNo: a.seatNo, row: a.row, col: a.col, label: a.label } })),
    ...ids.flatMap((eid) =>
      [...new Set(plan.assignments.filter((a) => a.examId === eid).map((a) => a.roomId))].map((roomId) =>
        prisma.examVenue.upsert({ where: { examId_roomId: { examId: eid, roomId } }, update: {}, create: { examId: eid, roomId } }),
      ),
    ),
    prisma.examSession.updateMany({ where: { id: { in: ids } }, data: { status: "SEATED" } }),
  ]);
  await audit(userId, "SEATING_GENERATED", "ExamSession", examId, { exams: ids.length, seated: plan.assignments.length, unseated: plan.unseated.length, adjacencyConflicts: plan.adjacencyConflicts, venues: plan.perVenue });
  return { ok: true as const, papers: ids.length, seated: plan.assignments.length, total: plan.totalStudents, unseated: plan.unseated.length, venues: plan.perVenue.map((v) => `${v.code} ${v.used}/${v.capacity}`), adjacencyConflicts: plan.adjacencyConflicts };
}

export async function assignInvigilatorsFor(examId: string, userId: string) {
  const exams = await sittingExams(examId);
  const ids = exams.map((e) => e.id);
  const seats = await prisma.seatAllocation.groupBy({ by: ["examId", "roomId"], where: { examId: { in: ids } }, _count: { _all: true } });
  if (!seats.length) return { ok: false as const, error: "Generate seating first" };
  const byRoom = new Map<string, { examId: string; count: number; max: number }>();
  for (const s of seats) {
    const cur = byRoom.get(s.roomId);
    if (!cur) byRoom.set(s.roomId, { examId: s.examId, count: s._count._all, max: s._count._all });
    else byRoom.set(s.roomId, { examId: s._count._all > cur.max ? s.examId : cur.examId, count: cur.count + s._count._all, max: Math.max(cur.max, s._count._all) });
  }
  const rooms = await prisma.room.findMany({ where: { id: { in: [...byRoom.keys()] } } });
  const needs = [...byRoom.entries()].map(([roomId, v]) => ({ examId: v.examId, moduleId: exams.find((e) => e.id === v.examId)!.moduleId, roomId, roomCode: rooms.find((r) => r.id === roomId)!.code, students: v.count }));
  const lecturers = await prisma.lecturer.findMany({ include: { _count: { select: { invigilations: true } }, assignments: { select: { moduleId: true } } } });
  const sameDay = await prisma.invigilation.findMany({ where: { exam: { date: exams[0].date, startMin: exams[0].startMin }, examId: { notIn: ids } }, select: { lecturerId: true } });
  const res = allocateInvigilators(
    needs,
    lecturers.map((l) => ({ id: l.id, name: l.name, department: l.department, dutyCount: l._count.invigilations, teachesModuleIds: new Set(l.assignments.map((a) => a.moduleId)) })),
    new Set(sameDay.map((s) => s.lecturerId)),
  );
  await prisma.$transaction([
    prisma.invigilation.deleteMany({ where: { examId: { in: ids } } }),
    ...res.assignments.map((a) => prisma.invigilation.create({ data: { examId: a.examId, roomId: a.roomId, lecturerId: a.lecturerId, role: a.role } })),
    prisma.examSession.updateMany({ where: { id: { in: ids } }, data: { status: res.shortfall.length ? "SEATED" : "READY" } }),
  ]);
  await audit(userId, "INVIGILATORS_ASSIGNED", "ExamSession", examId, { assigned: res.assignments.length, shortfall: res.shortfall });
  return { ok: true as const, assigned: res.assignments.map((a) => `${a.lecturerName} — ${a.roomCode} (${a.role.toLowerCase()})`), shortfall: res.shortfall, ready: res.shortfall.length === 0 };
}

export async function createExamRecord(input: { moduleCode: string; date: string; startMin: number; duration: number; cohortCodes: string[] }, userId: string) {
  const mod = await prisma.module.findFirst({ where: { code: input.moduleCode.toUpperCase() } });
  if (!mod) return { ok: false as const, error: `Unknown module ${input.moduleCode}` };
  const cohorts = await prisma.cohort.findMany({ where: { code: { in: input.cohortCodes.map((c) => c.toUpperCase()) } } });
  if (!cohorts.length) return { ok: false as const, error: "No matching student groups" };
  const exam = await prisma.examSession.create({
    data: { moduleId: mod.id, date: input.date, startMin: input.startMin, endMin: input.startMin + input.duration, term: TERMS.current, status: "PLANNED", cohorts: { create: cohorts.map((c) => ({ cohortId: c.id })) } },
  });
  await audit(userId, "EXAM_CREATED", "ExamSession", exam.id, { moduleId: mod.id, date: input.date, startMin: input.startMin, cohortIds: cohorts.map((c) => c.id) });
  return { ok: true as const, examId: exam.id, module: mod.code, cohorts: cohorts.map((c) => c.code) };
}
