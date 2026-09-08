
import { prisma } from "../prisma";
import { TERMS } from "../constants";
import { detectClashes } from "../engine/clash";
import { loadSessions, getPublishedTimetable, lecturerLimits } from "./timetable";
import { riskScore } from "../engine/grading";
import { studentAverages } from "./results";

export async function dashboardData() {
  const [students, cohorts, sheets, exams, rooms, lecturers, slots, published, recent, atRisk] = await Promise.all([
    prisma.student.count(),
    prisma.cohort.count(),
    prisma.resultSheet.groupBy({ by: ["status"], where: { term: TERMS.processing }, _count: { _all: true } }),
    prisma.examSession.findMany({ where: { date: { gte: "2026-09-01" } }, include: { module: true, _count: { select: { seats: true, invigilations: true } }, cohorts: { include: { cohort: true } } }, orderBy: [{ date: "asc" }, { startMin: "asc" }] }),
    prisma.room.findMany({ where: { active: true } }),
    prisma.lecturer.findMany({ include: { _count: { select: { invigilations: true } } } }),
    prisma.timeSlot.count(),
    getPublishedTimetable(),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { user: true } }),
    prisma.student.count({ where: { standing: { in: ["AT_RISK", "PROBATION"] } } }),
  ]);

  const sessions = published ? await loadSessions(published.id) : [];
  const limits = await lecturerLimits();
  const clashes = detectClashes(sessions, limits);
  const drafts = await prisma.timetable.findMany({ where: { term: TERMS.current, status: "DRAFT" } });
  let draftClashes = 0;
  for (const d of drafts) draftClashes += detectClashes(await loadSessions(d.id)).length;

  // room utilisation
  const perRoom = rooms.map((r) => {
    const used = sessions.filter((s) => s.roomId === r.id).length;
    const fill = used ? sessions.filter((s) => s.roomId === r.id).reduce((a, s) => a + s.cohortSize / r.capacity, 0) / used : 0;
    return { id: r.id, code: r.code, name: r.name, type: r.type, capacity: r.capacity, used, utilisation: slots ? used / slots : 0, fill };
  });
  const overall = slots && rooms.length ? sessions.length / (slots * rooms.length) : 0;

  // faculty load
  const load = lecturers.map((l) => {
    const hours = sessions.filter((s) => s.lecturerId === l.id).length;
    return { id: l.id, name: l.name, department: l.department, hours, max: l.maxHoursPerWeek, duties: l._count.invigilations, over: hours > l.maxHoursPerWeek };
  });

  // per-day load
  const perDay = [0, 1, 2, 3, 4, 5].map((d) => ({ day: d, sessions: sessions.filter((s) => s.day === d).length }));
  const perHour: Record<number, number> = {};
  for (const s of sessions) perHour[s.startMin / 60] = (perHour[s.startMin / 60] ?? 0) + 1;

  const sheetCounts: Record<string, number> = { DRAFT: 0, SUBMITTED: 0, APPROVED: 0, PUBLISHED: 0 };
  for (const s of sheets) sheetCounts[s.status] = s._count._all;
  const sheetTotal = Object.values(sheetCounts).reduce((a, b) => a + b, 0);

  const examReady = exams.filter((e) => e.status === "READY").length;
  const upcoming = exams.slice(0, 6);

  return {
    counts: { students, cohorts, atRisk, rooms: rooms.length, lecturers: lecturers.length, sessions: sessions.length, exams: exams.length, examReady },
    sheets: { counts: sheetCounts, total: sheetTotal },
    clashes: { published: clashes.length, drafts: draftClashes, draftCount: drafts.length },
    rooms: { overall, perRoom: perRoom.sort((a, b) => b.utilisation - a.utilisation) },
    faculty: { load: load.sort((a, b) => b.hours - a.hours), overloaded: load.filter((l) => l.over).length },
    perDay,
    perHour,
    upcoming,
    recent,
    published,
  };
}

/** At-risk students with a computed score & drivers (for dashboard + student directory). */
export async function atRiskStudents(limit = 12) {
  const students = await prisma.student.findMany({
    where: { standing: { in: ["AT_RISK", "PROBATION"] } },
    include: { cohort: true, progressions: { orderBy: { term: "asc" } }, enrolments: { include: { resits: true } } },
    take: 200,
  });
  const avgs = await studentAverages(students.map((s) => s.id));
  const scored = students.map((s) => {
    const progs = s.progressions;
    const last = progs[progs.length - 1];
    const prev = progs[progs.length - 2];
    const fails = s.enrolments.filter((e) => e.status === "FAILED").length;
    const resits = s.enrolments.reduce((a, e) => a + e.resits.length, 0);
    const score = riskScore({ average: avgs.get(s.id) ?? last?.average ?? null, fails, resits, trend: last && prev ? last.average - prev.average : null, incomplete: 0 });
    const drivers: string[] = [];
    if ((avgs.get(s.id) ?? 100) < 45) drivers.push(`avg ${Math.round(avgs.get(s.id)!)}`);
    if (fails) drivers.push(`${fails} fail${fails > 1 ? "s" : ""}`);
    if (resits) drivers.push(`${resits} resit${resits > 1 ? "s" : ""}`);
    if (last && prev && last.average - prev.average <= -8) drivers.push(`trend ${Math.round(last.average - prev.average)}`);
    return { student: s, score, drivers, average: avgs.get(s.id) ?? null };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
