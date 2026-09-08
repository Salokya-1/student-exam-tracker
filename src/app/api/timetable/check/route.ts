import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkCandidate } from "@/lib/engine/clash";
import { loadSessions } from "@/lib/data/timetable";
import { buildCandidate, type SessionInput } from "@/lib/services/timetable";

/** Live conflict check used by the session form before saving. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role === "STUDENT") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const input = (await req.json()) as SessionInput;
  if (!input.timetableId || !input.moduleId || !input.cohortId || !input.lecturerId || !input.roomId || !input.slotId) {
    return NextResponse.json({ clashes: [], incomplete: true });
  }
  try {
    const candidate = await buildCandidate(input);
    const existing = await loadSessions(input.timetableId);
    const clashes = checkCandidate(candidate, existing);
    // suggestions: free rooms of suitable size at the same slot, and free slots for the same room
    const busyRooms = new Set(existing.filter((s) => s.slotId === input.slotId && s.id !== input.id).map((s) => s.roomId));
    const lecturerBusy = new Set(existing.filter((s) => s.lecturerId === input.lecturerId && s.id !== input.id).map((s) => s.slotId));
    const cohortBusy = new Set(existing.filter((s) => s.cohortId === input.cohortId && s.id !== input.id).map((s) => s.slotId));
    const { prisma } = await import("@/lib/prisma");
    const rooms = await prisma.room.findMany({ where: { active: true, capacity: { gte: candidate.cohortSize }, ...(candidate.sessionType === "LAB" ? { type: "LAB" } : {}) }, orderBy: { capacity: "asc" } });
    const freeRooms = rooms.filter((r) => !busyRooms.has(r.id)).slice(0, 5).map((r) => ({ id: r.id, code: r.code, capacity: r.capacity, type: r.type }));
    const slots = await prisma.timeSlot.findMany({ orderBy: [{ day: "asc" }, { startMin: "asc" }] });
    const roomBusySlots = new Set(existing.filter((s) => s.roomId === input.roomId && s.id !== input.id).map((s) => s.slotId));
    const freeSlots = slots.filter((s) => !roomBusySlots.has(s.id) && !lecturerBusy.has(s.id) && !cohortBusy.has(s.id)).slice(0, 6).map((s) => ({ id: s.id, day: s.day, startMin: s.startMin }));
    return NextResponse.json({ clashes, freeRooms, freeSlots, candidate });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
