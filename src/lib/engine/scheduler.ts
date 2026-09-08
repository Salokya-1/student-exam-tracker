// Constraint-based automatic timetable generator.
//
// Approach: constructive heuristic + repair + local search.
//  1. Expand teaching demand into 1-hour "units".
//  2. Order units most-constrained-first (labs, large groups, busy lecturers).
//  3. For each unit evaluate every (slot, room) pair against HARD constraints
//     (lecturer free, group free, room free, capacity, room type, daily caps)
//     and pick the lowest SOFT cost (room waste, spread across days, gaps,
//     late slots, lecturer daily load).
//  4. Repair pass: relocate one blocking session to make room for unplaced units.
//  5. Improvement pass: hill-climb by moving sessions to cheaper feasible cells.
// Deterministic for a given seed so demos are reproducible.

import { rng } from "../constants";
import { detectClashes, type SessionLite } from "./clash";

export type Demand = {
  assignmentId: string;
  moduleId: string;
  moduleCode: string;
  requiresLab: boolean;
  cohortId: string;
  cohortCode: string;
  cohortSize: number;
  lecturerId: string;
  lecturerName: string;
  lecturerMaxHours: number;
  sessionType: string; // LECTURE | TUTORIAL | LAB
  hoursPerWeek: number;
};

export type RoomLite = { id: string; code: string; capacity: number; type: string };
export type SlotLite = { id: string; day: number; startMin: number; endMin: number };

export type PlacedSession = SessionLite & { assignmentId: string };

export type Unplaced = { demand: Demand; unit: number; reason: string };

export type ScheduleResult = {
  sessions: PlacedSession[];
  unplaced: Unplaced[];
  score: number;
  stats: {
    units: number;
    placed: number;
    roomUtilisation: number; // fraction of room-slots used
    avgRoomFill: number; // avg cohortSize/capacity
    clashes: number;
    iterations: number;
    repaired: number;
  };
};

export type SchedulerOptions = {
  seed?: number;
  maxLecturerDaily?: number;
  maxCohortDaily?: number;
  locked?: PlacedSession[]; // sessions that must stay as-is
  improvementPasses?: number;
};

const WEIGHTS = {
  waste: 6,
  sameDay: 12,
  lateSlot: 1.5,
  earlySlot: 0.5,
  gap: 4,
  lecturerDaily: 2,
  labInLecture: 3,
  hallForSmall: 4,
};

type Unit = { demand: Demand; unit: number };
type Cell = { slot: SlotLite; room: RoomLite; cost: number };

export function generateTimetable(
  demands: Demand[],
  rooms: RoomLite[],
  slots: SlotLite[],
  opts: SchedulerOptions = {},
): ScheduleResult {
  const rand = rng(opts.seed ?? 42);
  const maxLectDaily = opts.maxLecturerDaily ?? 4;
  const maxCohortDaily = opts.maxCohortDaily ?? 6;
  const sortedSlots = [...slots].sort((a, b) => a.day - b.day || a.startMin - b.startMin);
  const slotById = new Map(sortedSlots.map((s) => [s.id, s]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const demandById = new Map(demands.map((d) => [d.assignmentId, d]));

  // ── occupancy indexes ──
  const roomBusy = new Set<string>();
  const lectBusy = new Set<string>();
  const cohortBusy = new Set<string>();
  const lectDaily = new Map<string, number>();
  const cohortDaily = new Map<string, number>();
  const lectWeekly = new Map<string, number>();
  const placed: PlacedSession[] = [];
  // per cohort+day: start minutes of placed sessions and module ids (for O(1) soft-cost lookups)
  const cohortDaySlots = new Map<string, number[]>();
  const cohortDayModules = new Map<string, Map<string, number>>();

  const inc = (m: Map<string, number>, k: string, by: number) => m.set(k, (m.get(k) ?? 0) + by);

  const occupy = (s: PlacedSession) => {
    roomBusy.add(`${s.roomId}|${s.slotId}`);
    lectBusy.add(`${s.lecturerId}|${s.slotId}`);
    cohortBusy.add(`${s.cohortId}|${s.slotId}`);
    inc(lectDaily, `${s.lecturerId}|${s.day}`, 1);
    inc(cohortDaily, `${s.cohortId}|${s.day}`, 1);
    inc(lectWeekly, s.lecturerId, 1);
    const cd = `${s.cohortId}|${s.day}`;
    cohortDaySlots.set(cd, [...(cohortDaySlots.get(cd) ?? []), s.startMin]);
    const mods = cohortDayModules.get(cd) ?? new Map<string, number>();
    mods.set(s.moduleId, (mods.get(s.moduleId) ?? 0) + 1);
    cohortDayModules.set(cd, mods);
    placed.push(s);
  };
  const release = (s: PlacedSession) => {
    roomBusy.delete(`${s.roomId}|${s.slotId}`);
    lectBusy.delete(`${s.lecturerId}|${s.slotId}`);
    cohortBusy.delete(`${s.cohortId}|${s.slotId}`);
    inc(lectDaily, `${s.lecturerId}|${s.day}`, -1);
    inc(cohortDaily, `${s.cohortId}|${s.day}`, -1);
    inc(lectWeekly, s.lecturerId, -1);
    const cd = `${s.cohortId}|${s.day}`;
    const list = cohortDaySlots.get(cd) ?? [];
    const k = list.indexOf(s.startMin);
    if (k >= 0) list.splice(k, 1);
    const mods = cohortDayModules.get(cd);
    if (mods) {
      const n = (mods.get(s.moduleId) ?? 1) - 1;
      if (n <= 0) mods.delete(s.moduleId);
      else mods.set(s.moduleId, n);
    }
    const i = placed.indexOf(s);
    if (i >= 0) placed.splice(i, 1);
  };

  const lockedIds = new Set<string>();
  for (const l of opts.locked ?? []) {
    if (!slotById.has(l.slotId)) continue;
    lockedIds.add(l.id);
    occupy({ ...l });
  }

  // ── demand expansion & ordering ──
  const units: Unit[] = [];
  for (const d of demands) for (let i = 0; i < d.hoursPerWeek; i++) units.push({ demand: d, unit: i + 1 });

  const roomOk = (d: Demand, r: RoomLite) => {
    if (r.capacity < d.cohortSize) return false;
    if (d.sessionType === "LAB" && r.type !== "LAB") return false;
    if (d.sessionType !== "LAB" && r.type === "LAB" && !d.requiresLab) return false;
    return true;
  };
  const feasibleRooms = new Map<string, RoomLite[]>();
  for (const d of demands) feasibleRooms.set(d.assignmentId, rooms.filter((r) => roomOk(d, r)));

  const lecturerLoad = new Map<string, number>();
  const cohortLoad = new Map<string, number>();
  for (const d of demands) {
    inc(lecturerLoad, d.lecturerId, d.hoursPerWeek);
    inc(cohortLoad, d.cohortId, d.hoursPerWeek);
  }
  units.sort((a, b) => {
    const fa = feasibleRooms.get(a.demand.assignmentId)!.length;
    const fb = feasibleRooms.get(b.demand.assignmentId)!.length;
    if (fa !== fb) return fa - fb;
    const la = lecturerLoad.get(a.demand.lecturerId)! + cohortLoad.get(a.demand.cohortId)!;
    const lb = lecturerLoad.get(b.demand.lecturerId)! + cohortLoad.get(b.demand.cohortId)!;
    if (la !== lb) return lb - la;
    if (b.demand.cohortSize !== a.demand.cohortSize) return b.demand.cohortSize - a.demand.cohortSize;
    return a.unit - b.unit;
  });

  // ── constraints ──
  function hardBlock(d: Demand, slot: SlotLite, r: RoomLite): string | null {
    if (roomBusy.has(`${r.id}|${slot.id}`)) return "room already booked";
    if (lectBusy.has(`${d.lecturerId}|${slot.id}`)) return "lecturer already teaching";
    if (cohortBusy.has(`${d.cohortId}|${slot.id}`)) return "group already in class";
    if ((lectDaily.get(`${d.lecturerId}|${slot.day}`) ?? 0) >= maxLectDaily) return "lecturer daily cap";
    if ((cohortDaily.get(`${d.cohortId}|${slot.day}`) ?? 0) >= maxCohortDaily) return "group daily cap";
    if ((lectWeekly.get(d.lecturerId) ?? 0) >= d.lecturerMaxHours) return "lecturer weekly cap";
    return null;
  }

  function softCost(d: Demand, slot: SlotLite, r: RoomLite): number {
    let c = 0;
    c += ((r.capacity - d.cohortSize) / r.capacity) * WEIGHTS.waste;
    if (r.type === "HALL" && d.cohortSize < 60) c += WEIGHTS.hallForSmall;
    if (r.type === "LAB" && d.sessionType !== "LAB") c += WEIGHTS.labInLecture;
    const hour = slot.startMin / 60;
    if (hour >= 14) c += (hour - 13) * WEIGHTS.lateSlot;
    if (hour < 8) c += WEIGHTS.earlySlot;
    const cd = `${d.cohortId}|${slot.day}`;
    const sameDay = cohortDayModules.get(cd)?.has(d.moduleId) ?? false;
    let nearest = Infinity;
    for (const m of cohortDaySlots.get(cd) ?? []) {
      const diff = Math.abs(m - slot.startMin);
      if (diff < nearest) nearest = diff;
    }
    if (sameDay) c += WEIGHTS.sameDay;
    if (nearest !== Infinity && nearest > 60) c += WEIGHTS.gap * Math.min(3, nearest / 60 - 1);
    c += (lectDaily.get(`${d.lecturerId}|${slot.day}`) ?? 0) * WEIGHTS.lecturerDaily;
    c += rand() * 0.5;
    return c;
  }

  function findBest(d: Demand): { cell: Cell } | { reason: string } {
    const candidateRooms = feasibleRooms.get(d.assignmentId) ?? [];
    if (!candidateRooms.length) return { reason: `No room fits ${d.cohortSize} students for a ${d.sessionType.toLowerCase()}` };
    let best: Cell | null = null;
    const reasons: Record<string, number> = {};
    for (const slot of sortedSlots) {
      for (const r of candidateRooms) {
        const why = hardBlock(d, slot, r);
        if (why) {
          reasons[why] = (reasons[why] ?? 0) + 1;
          continue;
        }
        const cost = softCost(d, slot, r);
        if (!best || cost < best.cost) best = { slot, room: r, cost };
      }
    }
    if (best) return { cell: best };
    const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "no free cell";
    return { reason: `No feasible slot — dominant blocker: ${top}` };
  }

  let idCounter = 0;
  function commit(d: Demand, cell: Cell): PlacedSession {
    const s: PlacedSession = {
      id: `gen-${++idCounter}`,
      assignmentId: d.assignmentId,
      moduleId: d.moduleId,
      moduleCode: d.moduleCode,
      cohortId: d.cohortId,
      cohortCode: d.cohortCode,
      cohortSize: d.cohortSize,
      lecturerId: d.lecturerId,
      lecturerName: d.lecturerName,
      roomId: cell.room.id,
      roomCode: cell.room.code,
      roomCapacity: cell.room.capacity,
      roomType: cell.room.type,
      requiresLab: d.requiresLab,
      slotId: cell.slot.id,
      day: cell.slot.day,
      startMin: cell.slot.startMin,
      sessionType: d.sessionType,
    };
    occupy(s);
    return s;
  }

  // ── constructive phase ──
  let unplaced: Unplaced[] = [];
  for (const u of units) {
    const res = findBest(u.demand);
    if ("cell" in res) commit(u.demand, res.cell);
    else unplaced.push({ demand: u.demand, unit: u.unit, reason: res.reason });
  }

  // ── repair phase ──
  let iterations = 0;
  let repaired = 0;
  const stillUnplaced: Unplaced[] = [];
  for (const up of unplaced) {
    let fixed = false;
    const blockers = placed.filter(
      (s) => !lockedIds.has(s.id) && (s.lecturerId === up.demand.lecturerId || s.cohortId === up.demand.cohortId),
    );
    for (const s of blockers) {
      if (iterations++ > 600) break;
      release(s);
      const r1 = findBest(up.demand);
      if ("cell" in r1) {
        const newS = commit(up.demand, r1.cell);
        const sd = demandById.get(s.assignmentId);
        const r2 = sd ? findBest(sd) : { reason: "unknown" };
        if ("cell" in r2 && sd) {
          commit(sd, r2.cell);
          fixed = true;
          repaired++;
          break;
        }
        release(newS);
      }
      occupy(s);
    }
    if (!fixed) stillUnplaced.push(up);
  }
  unplaced = stillUnplaced;

  // ── improvement phase ──
  const passes = opts.improvementPasses ?? 2;
  for (let p = 0; p < passes; p++) {
    for (const s of [...placed]) {
      if (lockedIds.has(s.id)) continue;
      const d = demandById.get(s.assignmentId);
      if (!d) continue;
      const curSlot = slotById.get(s.slotId)!;
      const curRoom = roomById.get(s.roomId)!;
      release(s);
      const currentCost = softCost(d, curSlot, curRoom);
      const res = findBest(d);
      iterations++;
      if ("cell" in res && res.cell.cost < currentCost - 1) {
        Object.assign(s, {
          roomId: res.cell.room.id,
          roomCode: res.cell.room.code,
          roomCapacity: res.cell.room.capacity,
          roomType: res.cell.room.type,
          slotId: res.cell.slot.id,
          day: res.cell.slot.day,
          startMin: res.cell.slot.startMin,
        });
      }
      occupy(s);
    }
  }

  const generated = placed.filter((s) => !lockedIds.has(s.id));
  const clashes = detectClashes(placed);
  const roomSlots = rooms.length * slots.length;
  const avgFill = generated.length ? generated.reduce((a, s) => a + s.cohortSize / s.roomCapacity, 0) / generated.length : 0;
  const totalUnits = units.length;
  const score = Math.max(
    0,
    Math.round(100 * (generated.length / Math.max(1, totalUnits)) * (0.6 + 0.4 * avgFill) - clashes.length * 10),
  );

  return {
    sessions: generated,
    unplaced,
    score,
    stats: {
      units: totalUnits,
      placed: generated.length,
      roomUtilisation: roomSlots ? placed.length / roomSlots : 0,
      avgRoomFill: avgFill,
      clashes: clashes.length,
      iterations,
      repaired,
    },
  };
}
