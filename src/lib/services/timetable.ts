// Timetable services — business logic shared by server actions and the AI agent tools.
import { prisma } from "../prisma";
import { audit } from "../audit";
import { TERMS } from "../constants";
import { generateTimetable } from "../engine/scheduler";
import { checkCandidate, detectClashes, type SessionLite } from "../engine/clash";
import { loadDemands, loadRoomsLite, loadSessions, loadSlots } from "../data/timetable";

export type GenerateOptions = { name?: string; seed?: number; maxLecturerDaily?: number; maxCohortDaily?: number; improvementPasses?: number; keepLocked?: boolean };

export async function generateTimetableOption(opts: GenerateOptions, userId: string) {
  const name = opts.name || `Generated option ${new Date().toLocaleString("en-GB")}`;
  const seed = opts.seed ?? 42;
  const maxLecturerDaily = opts.maxLecturerDaily ?? 4;
  const maxCohortDaily = opts.maxCohortDaily ?? 6;
  const improvementPasses = opts.improvementPasses ?? 2;
  const [demands, rooms, slots] = await Promise.all([loadDemands(TERMS.current), loadRoomsLite(), loadSlots()]);
  let locked: Awaited<ReturnType<typeof loadSessions>> = [];
  if (opts.keepLocked ?? true) {
    const published = await prisma.timetable.findFirst({ where: { term: TERMS.current, status: "PUBLISHED" } });
    if (published) locked = (await loadSessions(published.id)).filter((s) => s.locked);
  }
  const t0 = Date.now();
  const lockedPlaced = locked.map((l) => ({ ...l, assignmentId: "" }));
  const result = generateTimetable(demands, rooms, slots, { seed, maxLecturerDaily, maxCohortDaily, improvementPasses, locked: lockedPlaced });
  const ms = Date.now() - t0;
  const tt = await prisma.timetable.create({ data: { name, term: TERMS.current, status: "DRAFT", generated: true, score: result.score } });
  const toRow = (s: { moduleId: string; cohortId: string; lecturerId: string; roomId: string; slotId: string; sessionType: string }, isLocked: boolean) => ({
    timetableId: tt.id,
    moduleId: s.moduleId,
    cohortId: s.cohortId,
    lecturerId: s.lecturerId,
    roomId: s.roomId,
    slotId: s.slotId,
    sessionType: s.sessionType,
    locked: isLocked,
  });
  const rows = [...result.sessions.map((s) => toRow(s, false)), ...lockedPlaced.map((s) => toRow(s, true))];
  for (let i = 0; i < rows.length; i += 200) await prisma.timetableSession.createMany({ data: rows.slice(i, i + 200) });
  const unplaced = result.unplaced.map((u) => ({ module: u.demand.moduleCode, cohort: u.demand.cohortCode, type: u.demand.sessionType, reason: u.reason }));
  await audit(userId, "TIMETABLE_GENERATED", "Timetable", tt.id, { name, seed, maxLecturerDaily, maxCohortDaily, ms, ...result.stats, score: result.score, unplaced });
  return { timetableId: tt.id, name, ms, score: result.score, stats: result.stats, unplaced };
}

export async function publishTimetableById(id: string, userId: string) {
  const sessions = await loadSessions(id);
  const high = detectClashes(sessions).filter((c) => c.severity === "HIGH");
  if (high.length) return { ok: false as const, error: `Cannot publish: ${high.length} hard conflict(s) remain`, conflicts: high.map((c) => c.message) };
  const tt = await prisma.timetable.findUnique({ where: { id } });
  if (!tt) return { ok: false as const, error: "Timetable not found" };
  await prisma.$transaction([
    prisma.timetable.updateMany({ where: { term: tt.term, status: "PUBLISHED" }, data: { status: "ARCHIVED" } }),
    prisma.timetable.update({ where: { id }, data: { status: "PUBLISHED" } }),
  ]);
  await audit(userId, "TIMETABLE_PUBLISHED", "Timetable", id, { name: tt.name, sessions: sessions.length });
  return { ok: true as const, name: tt.name, sessions: sessions.length };
}

export async function deleteTimetableById(id: string, userId: string) {
  const tt = await prisma.timetable.findUnique({ where: { id } });
  if (!tt) return { ok: false as const, error: "Timetable not found" };
  if (tt.status === "PUBLISHED") return { ok: false as const, error: "Published timetables cannot be deleted" };
  await prisma.timetable.delete({ where: { id } });
  await audit(userId, "TIMETABLE_DELETED", "Timetable", id, { name: tt.name });
  return { ok: true as const, name: tt.name };
}

/** Move every clashing (non-locked) session in a draft to the best free cell. */
export async function autoResolveTimetable(id: string, userId: string) {
  const tt = await prisma.timetable.findUnique({ where: { id } });
  if (!tt) return { ok: false as const, error: "Timetable not found" };
  if (tt.status === "PUBLISHED") return { ok: false as const, error: "Auto-resolve only runs on drafts — generate a new option or edit sessions individually" };
  const sessions = await loadSessions(id);
  const clashes = detectClashes(sessions).filter((c) => c.severity === "HIGH");
  const problem = new Set<string>();
  for (const c of clashes) {
    c.sessionIds.slice(1).forEach((sid) => problem.add(sid));
    if (c.type === "CAPACITY_OVERFLOW") problem.add(c.sessionIds[0]);
  }
  const [rooms, slots, lecturers] = await Promise.all([loadRoomsLite(), loadSlots(), prisma.lecturer.findMany()]);
  const keep = sessions.filter((s) => !problem.has(s.id));
  const toMove = sessions.filter((s) => problem.has(s.id) && !s.locked);
  const demands = toMove.map((s) => ({
    assignmentId: s.id,
    moduleId: s.moduleId,
    moduleCode: s.moduleCode,
    requiresLab: s.requiresLab,
    cohortId: s.cohortId,
    cohortCode: s.cohortCode,
    cohortSize: s.cohortSize,
    lecturerId: s.lecturerId,
    lecturerName: s.lecturerName,
    lecturerMaxHours: lecturers.find((l) => l.id === s.lecturerId)?.maxHoursPerWeek ?? 20,
    sessionType: s.sessionType,
    hoursPerWeek: 1,
  }));
  const res = generateTimetable(demands, rooms, slots, { seed: 11, locked: keep.map((k) => ({ ...k, assignmentId: "" })), improvementPasses: 0 });
  let moved = 0;
  for (const s of res.sessions) {
    await prisma.timetableSession.update({ where: { id: s.assignmentId }, data: { roomId: s.roomId, slotId: s.slotId } });
    moved++;
  }
  const after = detectClashes(await loadSessions(id)).filter((c) => c.severity === "HIGH").length;
  await audit(userId, "CLASHES_AUTO_RESOLVED", "Timetable", id, { moved, unresolved: res.unplaced.length, before: clashes.length, after });
  return { ok: true as const, moved, unresolved: res.unplaced.length, before: clashes.length, after };
}

export type SessionInput = { timetableId: string; moduleId: string; cohortId: string; lecturerId: string; roomId: string; slotId: string; sessionType: string; id?: string };

export async function buildCandidate(input: SessionInput): Promise<SessionLite> {
  const [m, c, l, r, s] = await Promise.all([
    prisma.module.findUniqueOrThrow({ where: { id: input.moduleId } }),
    prisma.cohort.findUniqueOrThrow({ where: { id: input.cohortId } }),
    prisma.lecturer.findUniqueOrThrow({ where: { id: input.lecturerId } }),
    prisma.room.findUniqueOrThrow({ where: { id: input.roomId } }),
    prisma.timeSlot.findUniqueOrThrow({ where: { id: input.slotId } }),
  ]);
  return {
    id: input.id ?? "candidate",
    moduleId: m.id,
    moduleCode: m.code,
    cohortId: c.id,
    cohortCode: c.code,
    cohortSize: c.size,
    lecturerId: l.id,
    lecturerName: l.name,
    roomId: r.id,
    roomCode: r.code,
    roomCapacity: r.capacity,
    roomType: r.type,
    requiresLab: m.requiresLab,
    slotId: s.id,
    day: s.day,
    startMin: s.startMin,
    sessionType: input.sessionType,
  };
}

export async function saveSessionRecord(input: SessionInput, options: { override: boolean; locked: boolean }, userId: string) {
  const candidate = await buildCandidate(input);
  const existing = await loadSessions(input.timetableId);
  const clashes = checkCandidate(candidate, existing);
  const hard = clashes.filter((c) => c.severity === "HIGH");
  if (hard.length && !options.override) return { ok: false as const, error: `Blocked by ${hard.length} hard conflict(s)`, clashes: clashes.map((c) => c.message) };
  const data = { timetableId: input.timetableId, moduleId: input.moduleId, cohortId: input.cohortId, lecturerId: input.lecturerId, roomId: input.roomId, slotId: input.slotId, sessionType: input.sessionType, locked: options.locked };
  const saved = input.id ? await prisma.timetableSession.update({ where: { id: input.id }, data }) : await prisma.timetableSession.create({ data });
  await audit(userId, input.id ? "SESSION_UPDATED" : "SESSION_CREATED", "TimetableSession", saved.id, { ...data, module: candidate.moduleCode, cohort: candidate.cohortCode, room: candidate.roomCode, day: candidate.day, startMin: candidate.startMin, override: options.override, clashes: clashes.map((c) => c.message) });
  return { ok: true as const, id: saved.id, override: options.override && hard.length > 0, clashes: clashes.map((c) => c.message) };
}

/** Move an existing session to another room/slot/lecturer (used by the agent). */
export async function moveSession(sessionId: string, patch: { roomCode?: string; day?: number; hour?: number; lecturerName?: string }, userId: string, override = false) {
  const s = await prisma.timetableSession.findUnique({ where: { id: sessionId }, include: { slot: true } });
  if (!s) return { ok: false as const, error: "Session not found" };
  let roomId = s.roomId;
  let slotId = s.slotId;
  let lecturerId = s.lecturerId;
  if (patch.roomCode) {
    const r = await prisma.room.findFirst({ where: { code: { contains: patch.roomCode.toUpperCase() } } });
    if (!r) return { ok: false as const, error: `Unknown room ${patch.roomCode}` };
    roomId = r.id;
  }
  if (patch.day !== undefined || patch.hour !== undefined) {
    const slot = await prisma.timeSlot.findFirst({ where: { day: patch.day ?? s.slot.day, startMin: (patch.hour ?? s.slot.startMin / 60) * 60 } });
    if (!slot) return { ok: false as const, error: "No teaching slot at that day/time (teaching runs Sun–Fri 07:00–17:00)" };
    slotId = slot.id;
  }
  if (patch.lecturerName) {
    const l = await prisma.lecturer.findFirst({ where: { name: { contains: patch.lecturerName } } });
    if (!l) return { ok: false as const, error: `Unknown lecturer ${patch.lecturerName}` };
    lecturerId = l.id;
  }
  return saveSessionRecord({ id: s.id, timetableId: s.timetableId, moduleId: s.moduleId, cohortId: s.cohortId, lecturerId, roomId, slotId, sessionType: s.sessionType }, { override, locked: s.locked }, userId);
}
