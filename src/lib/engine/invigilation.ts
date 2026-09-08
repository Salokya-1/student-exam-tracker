// Invigilator allocation — workload-balanced, conflict-aware.
// Rules: 1 chief per room + 1 assistant per 25 students beyond the first 25.
// A lecturer never invigilates their own module, is never double-booked in a
// sitting, and duties are spread so the least-loaded staff are picked first.

export type InvigLecturer = { id: string; name: string; department: string; dutyCount: number; teachesModuleIds: Set<string> };
export type InvigRoomNeed = { examId: string; moduleId: string; roomId: string; roomCode: string; students: number };
export type InvigAssignment = { examId: string; roomId: string; roomCode: string; lecturerId: string; lecturerName: string; role: "CHIEF" | "ASSISTANT" };

export function requiredInvigilators(students: number): number {
  if (students <= 0) return 0;
  return 1 + Math.max(0, Math.ceil((students - 25) / 25));
}

export function allocateInvigilators(
  needs: InvigRoomNeed[],
  lecturers: InvigLecturer[],
  busyInSitting: Set<string> = new Set(),
): { assignments: InvigAssignment[]; shortfall: { roomCode: string; missing: number }[] } {
  const assignments: InvigAssignment[] = [];
  const shortfall: { roomCode: string; missing: number }[] = [];
  const used = new Set(busyInSitting);
  const load = new Map(lecturers.map((l) => [l.id, l.dutyCount]));

  // Bigger rooms first so chiefs come from the fairest pool
  const ordered = [...needs].sort((a, b) => b.students - a.students);
  for (const need of ordered) {
    const req = requiredInvigilators(need.students);
    let filled = 0;
    for (let i = 0; i < req; i++) {
      const candidates = lecturers
        .filter((l) => !used.has(l.id) && !l.teachesModuleIds.has(need.moduleId))
        .sort((a, b) => (load.get(a.id)! - load.get(b.id)!) || a.name.localeCompare(b.name));
      const pick = candidates[0];
      if (!pick) break;
      used.add(pick.id);
      load.set(pick.id, load.get(pick.id)! + 1);
      assignments.push({
        examId: need.examId,
        roomId: need.roomId,
        roomCode: need.roomCode,
        lecturerId: pick.id,
        lecturerName: pick.name,
        role: i === 0 ? "CHIEF" : "ASSISTANT",
      });
      filled++;
    }
    if (filled < req) shortfall.push({ roomCode: need.roomCode, missing: req - filled });
  }
  return { assignments, shortfall };
}
