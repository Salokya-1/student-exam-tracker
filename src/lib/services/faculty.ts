import { prisma } from "../prisma";
import { audit } from "../audit";
import { detectClashes } from "../engine/clash";
import { getPublishedTimetable, loadSessions } from "../data/timetable";

/** Reassign a teaching allocation to another lecturer; published timetable sessions follow (blocked if it would create a lecturer clash). */
export async function reassignAssignment(assignmentId: string, lecturerId: string, userId: string) {
  const a = await prisma.teachingAssignment.findUnique({ where: { id: assignmentId }, include: { module: true, cohort: true, lecturer: true } });
  if (!a) return { ok: false as const, error: "Assignment not found" };
  if (a.lecturerId === lecturerId) return { ok: false as const, error: "Already assigned to that lecturer" };
  const to = await prisma.lecturer.findUnique({ where: { id: lecturerId } });
  if (!to) return { ok: false as const, error: "Lecturer not found" };
  const tt = await getPublishedTimetable();
  let updated = 0;
  if (tt) {
    const sessions = await loadSessions(tt.id);
    const moved = sessions.map((s) => (s.moduleId === a.moduleId && s.cohortId === a.cohortId && s.sessionType === a.sessionType ? { ...s, lecturerId } : s));
    const clashes = detectClashes(moved).filter((c) => c.type === "LECTURER_CLASH");
    if (clashes.length) return { ok: false as const, error: `Reassignment would create ${clashes.length} lecturer clash(es): ${clashes[0].message}` };
    const res = await prisma.timetableSession.updateMany({ where: { timetableId: tt.id, moduleId: a.moduleId, cohortId: a.cohortId, sessionType: a.sessionType }, data: { lecturerId } });
    updated = res.count;
  }
  await prisma.teachingAssignment.update({ where: { id: assignmentId }, data: { lecturerId } });
  await audit(userId, "ALLOCATION_REASSIGNED", "TeachingAssignment", assignmentId, { module: a.module.code, cohort: a.cohort.code, from: a.lecturer.name, to: to.name, sessionsUpdated: updated });
  return { ok: true as const, module: a.module.code, cohort: a.cohort.code, sessionType: a.sessionType, from: a.lecturer.name, to: to.name, sessionsUpdated: updated, toId: to.id };
}

export async function findAssignment(moduleCode: string, cohortCode: string, sessionType?: string) {
  return prisma.teachingAssignment.findFirst({
    where: { module: { code: moduleCode.toUpperCase() }, cohort: { code: cohortCode.toUpperCase() }, ...(sessionType ? { sessionType: sessionType.toUpperCase() } : {}) },
    include: { module: true, cohort: true, lecturer: true },
  });
}
