import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { requireRole, can } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPublishedTimetable, loadSessions } from "@/lib/data/timetable";
import { Card, KV, PageHeader } from "@/components/ui";
import { BackLink } from "@/components/Shell";
import { WeekGrid } from "@/components/WeekGrid";
import { DAY_NAMES, fmtDate, timeRange } from "@/lib/constants";
import { saveRoom } from "../actions";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const user = await requireRole("ADMIN", "RTE_STAFF", "LECTURER");
  const { id } = await params;
  const { msg } = await searchParams;
  const room = await prisma.room.findUnique({ where: { id }, include: { examVenues: { include: { exam: { include: { module: true, _count: { select: { seats: true } } } } } } } });
  if (!room) notFound();
  const tt = await getPublishedTimetable();
  const sessions = tt ? (await loadSessions(tt.id)).filter((s) => s.roomId === id) : [];
  const total = await prisma.timeSlot.count();
  const perDay = [0, 1, 2, 3, 4, 5].map((d) => sessions.filter((s) => s.day === d).length);
  const perHour = Array.from({ length: 10 }, (_, i) => sessions.filter((s) => s.startMin === (7 + i) * 60).length);
  const fill = sessions.length ? sessions.reduce((a, s) => a + s.cohortSize / room.capacity, 0) / sessions.length : 0;
  const equipment = JSON.parse(room.equipment) as string[];

  return (
    <>
      <BackLink href="/rooms">Rooms</BackLink>
      <PageHeader eyebrow={`${room.building} · ${room.type}`} title={`${room.code} — ${room.name}`} description={equipment.join(" · ")} />
      {msg && <div className="mb-4 border border-hairline-2 bg-elevated px-4 py-3 text-ink text-[13px]">{msg}</div>}
      <div className="grid xl:grid-cols-4 gap-4">
        <Card title="Utilisation">
          <KV k="Capacity" v={room.capacity} />
          <KV k="Exam layout" v={`${room.rows} rows × ${room.cols}`} />
          <KV k="Hours used / week" v={`${sessions.length} of ${total}`} />
          <KV k="Utilisation" v={`${Math.round((sessions.length / Math.max(1, total)) * 100)}%`} />
          <KV k="Average fill" v={sessions.length ? `${Math.round(fill * 100)}%` : "—"} />
          <KV k="Busiest day" v={sessions.length ? DAY_NAMES[perDay.indexOf(Math.max(...perDay))] : "—"} />
          <KV k="Status" v={room.active ? "Active" : "Inactive"} />
        </Card>
        <Card title="Hourly demand heatmap" subtitle="How often each hour is booked across the week" className="xl:col-span-3">
          <div className="grid grid-cols-10 gap-1">
            {perHour.map((n, i) => (
              <div key={i} className="text-center">
                <div className="h-16 flex items-end">
                  <div className="w-full" style={{ height: `${Math.max(6, (n / 6) * 100)}%`, background: `rgba(76,152,185,${0.25 + (n / 6) * 0.75})` }} />
                </div>
                <div className="caps mt-1">{String(7 + i).padStart(2, "0")}</div>
                <div className="text-[11px] text-ink num">{n}/6</div>
              </div>
            ))}
          </div>
          {can(user.role, "rooms:edit") && (
            <details className="mt-6">
              <summary className="text-[12px] cursor-pointer text-body">Edit room</summary>
              <ActionForm action={saveRoom} className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[13px]">
                <input type="hidden" name="id" value={room.id} />
                <input name="code" className="input input-sm" defaultValue={room.code} />
                <input name="name" className="input input-sm" defaultValue={room.name} />
                <input name="building" className="input input-sm" defaultValue={room.building} />
                <select name="type" className="input input-sm" defaultValue={room.type}>
                  <option>LECTURE</option>
                  <option>LAB</option>
                  <option>SEMINAR</option>
                  <option>HALL</option>
                </select>
                <input name="capacity" type="number" className="input input-sm" defaultValue={room.capacity} />
                <input name="rows" type="number" className="input input-sm" defaultValue={room.rows} />
                <input name="cols" type="number" className="input input-sm" defaultValue={room.cols} />
                <label className="flex items-center gap-2 text-[12px]">
                  <input type="checkbox" name="active" defaultChecked={room.active} /> Active
                </label>
                <input name="equipment" className="input input-sm col-span-2 md:col-span-3" defaultValue={equipment.join(", ")} />
                <SubmitButton className="btn btn-primary btn-sm">Save</SubmitButton>
              </ActionForm>
            </details>
          )}
        </Card>
      </div>
      <Card title="Weekly bookings" subtitle={tt?.name} className="mt-4" pad={false}>
        <WeekGrid sessions={sessions} mode="room" />
      </Card>
      <Card title="Examination use" className="mt-4" pad={false}>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Exam</th>
              <th>Seated here</th>
            </tr>
          </thead>
          <tbody>
            {room.examVenues.map((v) => (
              <tr key={v.id}>
                <td className="ink whitespace-nowrap">
                  {fmtDate(v.exam.date)} <span className="text-muted">{timeRange(v.exam.startMin, v.exam.endMin)}</span>
                </td>
                <td>
                  {v.exam.module.code} <span className="text-muted">{v.exam.module.name}</span>
                </td>
                <td className="num">{v.exam._count.seats}</td>
              </tr>
            ))}
            {!room.examVenues.length && (
              <tr>
                <td colSpan={3} className="text-muted">
                  Not used as an exam venue.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
