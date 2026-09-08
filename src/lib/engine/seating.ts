// Examination seating generator.
//
// Given every exam in one sitting (same date/time) and the venue pool, it:
//  - checks total capacity,
//  - builds an interleaved student stream (round-robin across modules, then
//    across cohorts) so horizontally adjacent seats hold different papers,
//  - fills venues largest-first, row-major, producing seat numbers/labels,
//  - reports adjacency conflicts (same paper side-by-side) as a quality metric.

import { seatLabel } from "../constants";

export type SeatStudent = { id: string; studentNo: string; name: string; cohortCode: string };
export type SeatExam = { examId: string; moduleCode: string; students: SeatStudent[] };
export type SeatVenue = { roomId: string; code: string; rows: number; cols: number; capacity: number };

export type SeatAssignment = {
  examId: string;
  moduleCode: string;
  roomId: string;
  roomCode: string;
  studentId: string;
  studentNo: string;
  name: string;
  cohortCode: string;
  seatNo: number;
  row: number;
  col: number;
  label: string;
};

export type SeatingPlan = {
  assignments: SeatAssignment[];
  unseated: { examId: string; student: SeatStudent }[];
  perVenue: { roomId: string; code: string; used: number; capacity: number; papers: Record<string, number> }[];
  totalStudents: number;
  totalCapacity: number;
  adjacencyConflicts: number;
};

function interleave<T>(groups: T[][]): T[] {
  const out: T[] = [];
  const idx = groups.map(() => 0);
  // weighted round-robin: bigger groups emit proportionally more often
  const total = groups.reduce((a, g) => a + g.length, 0);
  const credit = groups.map(() => 0);
  for (let n = 0; n < total; n++) {
    let best = -1;
    let bestVal = -Infinity;
    for (let g = 0; g < groups.length; g++) {
      if (idx[g] >= groups[g].length) continue;
      credit[g] += groups[g].length / total;
      if (credit[g] > bestVal) {
        bestVal = credit[g];
        best = g;
      }
    }
    if (best < 0) break;
    credit[best] -= 1;
    out.push(groups[best][idx[best]++]);
  }
  return out;
}

export function generateSeating(exams: SeatExam[], venues: SeatVenue[]): SeatingPlan {
  type Item = SeatStudent & { examId: string; moduleCode: string };
  const groups: Item[][] = exams.map((e) => {
    // within a paper, interleave cohorts, each sorted by studentNo
    const byCohort = new Map<string, SeatStudent[]>();
    for (const s of [...e.students].sort((a, b) => a.studentNo.localeCompare(b.studentNo))) {
      const l = byCohort.get(s.cohortCode) ?? [];
      l.push(s);
      byCohort.set(s.cohortCode, l);
    }
    const cohortLists = [...byCohort.values()];
    const mixed = cohortLists.length > 1 ? interleave(cohortLists) : cohortLists[0] ?? [];
    return mixed.map((s) => ({ ...s, examId: e.examId, moduleCode: e.moduleCode }));
  });

  const stream: Item[] = groups.length > 1 ? interleave(groups) : groups[0] ?? [];
  const totalStudents = stream.length;
  const sortedVenues = [...venues].sort((a, b) => b.capacity - a.capacity);
  const totalCapacity = sortedVenues.reduce((a, v) => a + Math.min(v.capacity, v.rows * v.cols), 0);

  const assignments: SeatAssignment[] = [];
  const perVenue: SeatingPlan["perVenue"] = [];
  let cursor = 0;
  let adjacencyConflicts = 0;

  for (const v of sortedVenues) {
    const cap = Math.min(v.capacity, v.rows * v.cols);
    const papers: Record<string, number> = {};
    let used = 0;
    let seatNo = 0;
    outer: for (let r = 1; r <= v.rows; r++) {
      for (let c = 1; c <= v.cols; c++) {
        if (seatNo >= cap || cursor >= stream.length) break outer;
        const st = stream[cursor++];
        seatNo++;
        used++;
        papers[st.moduleCode] = (papers[st.moduleCode] ?? 0) + 1;
        const a: SeatAssignment = {
          examId: st.examId,
          moduleCode: st.moduleCode,
          roomId: v.roomId,
          roomCode: v.code,
          studentId: st.id,
          studentNo: st.studentNo,
          name: st.name,
          cohortCode: st.cohortCode,
          seatNo,
          row: r,
          col: c,
          label: seatLabel(r, c),
        };
        // adjacency check with the seat to the left
        if (c > 1) {
          const left = assignments[assignments.length - 1];
          if (left && left.roomId === v.roomId && left.row === r && left.moduleCode === a.moduleCode && exams.length > 1) {
            adjacencyConflicts++;
          }
        }
        assignments.push(a);
      }
    }
    perVenue.push({ roomId: v.roomId, code: v.code, used, capacity: cap, papers });
    if (cursor >= stream.length) break;
  }

  const unseated = stream.slice(cursor).map((s) => ({
    examId: s.examId,
    student: { id: s.id, studentNo: s.studentNo, name: s.name, cohortCode: s.cohortCode },
  }));

  return { assignments, unseated, perVenue, totalStudents, totalCapacity, adjacencyConflicts };
}

/** Pick the smallest set of venues (largest-first) covering the student count. */
export function suggestVenues(venues: SeatVenue[], needed: number, busyRoomIds: Set<string>): SeatVenue[] {
  const pool = venues
    .filter((v) => !busyRoomIds.has(v.roomId))
    .sort((a, b) => b.capacity - a.capacity);
  const chosen: SeatVenue[] = [];
  let cap = 0;
  // Prefer a single venue that fits with least waste
  const single = [...pool].filter((v) => v.capacity >= needed).sort((a, b) => a.capacity - b.capacity)[0];
  if (single) return [single];
  for (const v of pool) {
    chosen.push(v);
    cap += v.capacity;
    if (cap >= needed) break;
  }
  return chosen;
}
