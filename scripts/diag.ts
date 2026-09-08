import { PrismaClient } from "@prisma/client";
import { detectClashes } from "../src/lib/engine/clash";
const prisma = new PrismaClient();
async function main() {
  const sessions = await prisma.timetableSession.findMany({ where: { timetableId: "tt-master" }, include: { module: true, cohort: true, lecturer: true, room: true, slot: true } });
  const lite = sessions.map((s) => ({ id: s.id, moduleId: s.moduleId, moduleCode: s.module.code, cohortId: s.cohortId, cohortCode: s.cohort.code, cohortSize: s.cohort.size, lecturerId: s.lecturerId, lecturerName: s.lecturer.name, roomId: s.roomId, roomCode: s.room.code, roomCapacity: s.room.capacity, roomType: s.room.type, requiresLab: s.module.requiresLab, slotId: s.slotId, day: s.slot.day, startMin: s.slot.startMin, sessionType: s.sessionType }));
  const clashes = detectClashes(lite);
  const counts: Record<string, number> = {};
  for (const c of clashes) counts[c.type] = (counts[c.type] ?? 0) + 1;
  console.log(counts);
  console.log(clashes.slice(0, 5).map((c) => c.message));
  const byType: Record<string, number> = {};
  for (const s of lite) byType[`${s.sessionType}->${s.roomType}`] = (byType[`${s.sessionType}->${s.roomType}`] ?? 0) + 1;
  console.log(byType);
}
main().finally(() => prisma.$disconnect());
