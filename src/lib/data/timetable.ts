
import { prisma } from "../prisma";
import { TERMS } from "../constants";
import type { SessionLite } from "../engine/clash";
import type { Demand, RoomLite, SlotLite } from "../engine/scheduler";

export type SessionFull = SessionLite & {
  timetableId: string;
  moduleName: string;
  endMin: number;
  locked: boolean;
};

const include = { module: true, cohort: true, lecturer: true, room: true, slot: true } as const;

type Row = NonNullable<Awaited<ReturnType<typeof prisma.timetableSession.findFirst>>> & {
  module: { code: string; name: string; requiresLab: boolean };
  cohort: { code: string; size: number };
  lecturer: { name: string };
  room: { code: string; capacity: number; type: string };
  slot: { day: number; startMin: number; endMin: number };
};

export function toLite(s: Row): SessionFull {
  return {
    id: s.id,
    timetableId: s.timetableId,
    moduleId: s.moduleId,
    moduleCode: s.module.code,
    moduleName: s.module.name,
    cohortId: s.cohortId,
    cohortCode: s.cohort.code,
    cohortSize: s.cohort.size,
    lecturerId: s.lecturerId,
    lecturerName: s.lecturer.name,
    roomId: s.roomId,
    roomCode: s.room.code,
    roomCapacity: s.room.capacity,
    roomType: s.room.type,
    requiresLab: s.module.requiresLab,
    slotId: s.slotId,
    day: s.slot.day,
    startMin: s.slot.startMin,
    endMin: s.slot.endMin,
    sessionType: s.sessionType,
    locked: s.locked,
  };
}

export async function loadSessions(timetableId: string): Promise<SessionFull[]> {
  const rows = await prisma.timetableSession.findMany({ where: { timetableId }, include });
  return rows.map((r) => toLite(r as Row));
}

export async function listTimetables(term = TERMS.current) {
  return prisma.timetable.findMany({ where: { term }, orderBy: [{ status: "desc" }, { createdAt: "desc" }], include: { _count: { select: { sessions: true } } } });
}

export async function getPublishedTimetable(term = TERMS.current) {
  return prisma.timetable.findFirst({ where: { term, status: "PUBLISHED" } });
}

export async function loadDemands(term = TERMS.current): Promise<Demand[]> {
  const rows = await prisma.teachingAssignment.findMany({ where: { term }, include: { module: true, cohort: true, lecturer: true } });
  return rows.map((a) => ({
    assignmentId: a.id,
    moduleId: a.moduleId,
    moduleCode: a.module.code,
    requiresLab: a.module.requiresLab,
    cohortId: a.cohortId,
    cohortCode: a.cohort.code,
    cohortSize: a.cohort.size,
    lecturerId: a.lecturerId,
    lecturerName: a.lecturer.name,
    lecturerMaxHours: a.lecturer.maxHoursPerWeek,
    sessionType: a.sessionType,
    hoursPerWeek: a.hoursPerWeek,
  }));
}

export async function loadRoomsLite(): Promise<RoomLite[]> {
  const rooms = await prisma.room.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  return rooms.map((r) => ({ id: r.id, code: r.code, capacity: r.capacity, type: r.type }));
}

export async function loadSlots(): Promise<SlotLite[]> {
  const slots = await prisma.timeSlot.findMany({ orderBy: [{ day: "asc" }, { startMin: "asc" }] });
  return slots.map((s) => ({ id: s.id, day: s.day, startMin: s.startMin, endMin: s.endMin }));
}

export async function lecturerLimits(): Promise<Map<string, number>> {
  const ls = await prisma.lecturer.findMany({ select: { id: true, maxHoursPerWeek: true } });
  return new Map(ls.map((l) => [l.id, l.maxHoursPerWeek]));
}
