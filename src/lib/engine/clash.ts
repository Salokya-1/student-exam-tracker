// Conflict detection engine — pure functions, no DB access.
// Works on a lightweight session shape so it can be used by the DB layer,
// the scheduler and the live "check before save" API alike.

export type SessionLite = {
  id: string;
  moduleId: string;
  moduleCode: string;
  cohortId: string;
  cohortCode: string;
  cohortSize: number;
  lecturerId: string;
  lecturerName: string;
  roomId: string;
  roomCode: string;
  roomCapacity: number;
  roomType: string;
  requiresLab: boolean;
  slotId: string;
  day: number;
  startMin: number;
  sessionType: string;
};

export type ClashType =
  | "ROOM_DOUBLE_BOOKED"
  | "LECTURER_CLASH"
  | "COHORT_CLASH"
  | "CAPACITY_OVERFLOW"
  | "ROOM_TYPE_MISMATCH"
  | "LECTURER_OVERLOAD";

export type Clash = {
  type: ClashType;
  severity: "HIGH" | "MEDIUM" | "LOW";
  message: string;
  sessionIds: string[];
  slotId?: string;
  day?: number;
  startMin?: number;
};

const LABELS: Record<ClashType, string> = {
  ROOM_DOUBLE_BOOKED: "Room double-booked",
  LECTURER_CLASH: "Lecturer clash",
  COHORT_CLASH: "Student group overlap",
  CAPACITY_OVERFLOW: "Capacity overflow",
  ROOM_TYPE_MISMATCH: "Room type mismatch",
  LECTURER_OVERLOAD: "Lecturer overload",
};

export const clashLabel = (t: ClashType) => LABELS[t];

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of arr) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

/** Detect every hard/soft conflict inside a set of sessions. */
export function detectClashes(
  sessions: SessionLite[],
  lecturerLimits: Map<string, number> = new Map(),
): Clash[] {
  const out: Clash[] = [];

  // Per-slot pairwise resource collisions
  for (const [slotId, list] of groupBy(sessions, (s) => s.slotId)) {
    const meta = { slotId, day: list[0].day, startMin: list[0].startMin };
    for (const [, byRoom] of groupBy(list, (s) => s.roomId)) {
      if (byRoom.length > 1) {
        out.push({
          type: "ROOM_DOUBLE_BOOKED",
          severity: "HIGH",
          message: `${byRoom[0].roomCode} booked ${byRoom.length}× at the same time (${byRoom
            .map((s) => `${s.moduleCode}/${s.cohortCode}`)
            .join(", ")})`,
          sessionIds: byRoom.map((s) => s.id),
          ...meta,
        });
      }
    }
    for (const [, byLect] of groupBy(list, (s) => s.lecturerId)) {
      if (byLect.length > 1) {
        out.push({
          type: "LECTURER_CLASH",
          severity: "HIGH",
          message: `${byLect[0].lecturerName} is scheduled for ${byLect.length} sessions at once (${byLect
            .map((s) => `${s.moduleCode}/${s.cohortCode} in ${s.roomCode}`)
            .join(", ")})`,
          sessionIds: byLect.map((s) => s.id),
          ...meta,
        });
      }
    }
    for (const [, byCohort] of groupBy(list, (s) => s.cohortId)) {
      if (byCohort.length > 1) {
        out.push({
          type: "COHORT_CLASH",
          severity: "HIGH",
          message: `Group ${byCohort[0].cohortCode} has ${byCohort.length} overlapping sessions (${byCohort
            .map((s) => s.moduleCode)
            .join(", ")})`,
          sessionIds: byCohort.map((s) => s.id),
          ...meta,
        });
      }
    }
  }

  // Single-session constraint violations
  for (const s of sessions) {
    if (s.cohortSize > s.roomCapacity) {
      out.push({
        type: "CAPACITY_OVERFLOW",
        severity: "HIGH",
        message: `${s.cohortCode} (${s.cohortSize} students) exceeds ${s.roomCode} capacity of ${s.roomCapacity}`,
        sessionIds: [s.id],
        slotId: s.slotId,
        day: s.day,
        startMin: s.startMin,
      });
    }
    if (s.sessionType === "LAB" && s.roomType !== "LAB") {
      out.push({
        type: "ROOM_TYPE_MISMATCH",
        severity: "MEDIUM",
        message: `${s.moduleCode} ${s.sessionType.toLowerCase()} for ${s.cohortCode} needs a lab but ${s.roomCode} is a ${s.roomType.toLowerCase()} room`,
        sessionIds: [s.id],
        slotId: s.slotId,
        day: s.day,
        startMin: s.startMin,
      });
    }
  }

  // Weekly overload
  for (const [lecturerId, list] of groupBy(sessions, (s) => s.lecturerId)) {
    const limit = lecturerLimits.get(lecturerId);
    if (limit && list.length > limit) {
      out.push({
        type: "LECTURER_OVERLOAD",
        severity: "MEDIUM",
        message: `${list[0].lecturerName} has ${list.length} contact hours/week (limit ${limit})`,
        sessionIds: list.map((s) => s.id),
      });
    }
  }

  return out;
}

/** Conflicts a candidate session would cause against the existing set (excluding itself). */
export function checkCandidate(candidate: SessionLite, existing: SessionLite[]): Clash[] {
  const others = existing.filter((s) => s.id !== candidate.id);
  const all = detectClashes([...others, candidate]);
  return all.filter((c) => c.sessionIds.includes(candidate.id));
}

export function summariseClashes(clashes: Clash[]) {
  const counts: Record<string, number> = {};
  for (const c of clashes) counts[c.type] = (counts[c.type] ?? 0) + 1;
  return {
    total: clashes.length,
    high: clashes.filter((c) => c.severity === "HIGH").length,
    counts,
  };
}
