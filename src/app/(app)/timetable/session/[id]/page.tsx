import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card } from "@/components/ui";
import { BackLink } from "@/components/Shell";
import { SessionForm } from "@/components/SessionForm";
import { deleteSession, saveSession } from "../../actions";
import { TERMS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tt?: string; msg?: string }> }) {
  await requireRole("ADMIN", "RTE_STAFF");
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === "new";
  const session = isNew ? null : await prisma.timetableSession.findUnique({ where: { id } });
  if (!isNew && !session) notFound();
  const timetableId = session?.timetableId ?? sp.tt;
  if (!timetableId) notFound();
  const tt = await prisma.timetable.findUnique({ where: { id: timetableId } });
  if (!tt) notFound();

  const [modules, cohorts, lecturers, rooms, slots, assignments] = await Promise.all([
    prisma.module.findMany({ where: { semester: 1 }, orderBy: { code: "asc" } }),
    prisma.cohort.findMany({ orderBy: { code: "asc" } }),
    prisma.lecturer.findMany({ orderBy: { name: "asc" } }),
    prisma.room.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.timeSlot.findMany({ orderBy: [{ day: "asc" }, { startMin: "asc" }] }),
    prisma.teachingAssignment.findMany({ where: { term: TERMS.current }, select: { moduleId: true, cohortId: true, lecturerId: true, sessionType: true } }),
  ]);

  return (
    <>
      <BackLink href={`/timetable?tt=${timetableId}`}>Back to {tt.name}</BackLink>
      <PageHeader eyebrow={tt.name} title={isNew ? "Add session" : "Edit session"} description="Conflicts are checked live against every other session in this timetable before you save." />
      {sp.msg && <div className="mb-4 border border-danger bg-[rgba(241,58,44,0.08)] px-4 py-3 text-ink text-[13px]">{sp.msg}</div>}
      <Card>
        <SessionForm
          timetableId={timetableId}
          initial={session ? { id: session.id, moduleId: session.moduleId, cohortId: session.cohortId, lecturerId: session.lecturerId, roomId: session.roomId, slotId: session.slotId, sessionType: session.sessionType, locked: session.locked } : null}
          modules={modules.map((m) => ({ id: m.id, code: m.code, name: m.name, requiresLab: m.requiresLab }))}
          cohorts={cohorts.map((c) => ({ id: c.id, code: c.code, size: c.size }))}
          lecturers={lecturers.map((l) => ({ id: l.id, name: l.name }))}
          rooms={rooms.map((r) => ({ id: r.id, code: r.code, capacity: r.capacity, type: r.type }))}
          slots={slots.map((s) => ({ id: s.id, day: s.day, startMin: s.startMin }))}
          assignments={assignments}
          save={saveSession}
          remove={session ? deleteSession : undefined}
          published={tt.status === "PUBLISHED"}
        />
      </Card>
    </>
  );
}
