import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { requireRole, can } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPublishedTimetable, loadSessions } from "@/lib/data/timetable";
import { Bar, Card, PageHeader, Pill, Stat } from "@/components/ui";
import { DAY_NAMES } from "@/lib/constants";
import { saveRoom } from "./actions";

export const dynamic = "force-dynamic";

export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ msg?: string; day?: string; hour?: string; min?: string }> }) {
  const user = await requireRole("ADMIN", "RTE_STAFF", "LECTURER");
  const sp = await searchParams;
  const [rooms, tt, slots] = await Promise.all([prisma.room.findMany({ orderBy: [{ building: "asc" }, { code: "asc" }] }), getPublishedTimetable(), prisma.timeSlot.findMany()]);
  const sessions = tt ? await loadSessions(tt.id) : [];
  const total = slots.length;
  const rows = rooms.map((r) => {
    const mine = sessions.filter((s) => s.roomId === r.id);
    const fill = mine.length ? mine.reduce((a, s) => a + s.cohortSize / r.capacity, 0) / mine.length : 0;
    return { r, used: mine.length, util: total ? mine.length / total : 0, fill, equipment: JSON.parse(r.equipment) as string[] };
  });
  const overall = rooms.length && total ? sessions.length / (rooms.length * total) : 0;
  const seatHours = sessions.reduce((a, s) => a + s.cohortSize, 0);
  const seatCapacityHours = rooms.reduce((a, r) => a + r.capacity, 0) * total;

  // availability finder
  const day = sp.day !== undefined && sp.day !== "" ? Number(sp.day) : null;
  const hour = sp.hour ? Number(sp.hour) : null;
  const minCap = sp.min ? Number(sp.min) : 0;
  const finder = day !== null && hour !== null ? rows.filter((x) => x.r.capacity >= minCap && !sessions.some((s) => s.roomId === x.r.id && s.day === day && s.startMin === hour * 60)) : null;

  return (
    <>
      <PageHeader
        eyebrow="Physical resources"
        title="Rooms & venues"
        description="Inventory, capacities, equipment, live utilisation from the published timetable and an availability finder."
        actions={
          can(user.role, "rooms:edit") ? (
            <details className="relative">
              <summary className="btn btn-primary btn-sm cursor-pointer list-none">+ Add room</summary>
              <ActionForm action={saveRoom} className="absolute right-0 top-10 z-20 w-[380px] card card-pad grid grid-cols-2 gap-2 text-[13px]">
                <input name="code" className="input input-sm" placeholder="Code (e.g. LB-107)" required />
                <input name="name" className="input input-sm" placeholder="Name" required />
                <input name="building" className="input input-sm" placeholder="Building" required />
                <select name="type" className="input input-sm">
                  <option>LECTURE</option>
                  <option>LAB</option>
                  <option>SEMINAR</option>
                  <option>HALL</option>
                </select>
                <input name="capacity" type="number" className="input input-sm" placeholder="Capacity" required />
                <div className="grid grid-cols-2 gap-2">
                  <input name="rows" type="number" className="input input-sm" placeholder="Rows" defaultValue={6} />
                  <input name="cols" type="number" className="input input-sm" placeholder="Cols" defaultValue={8} />
                </div>
                <input name="equipment" className="input input-sm col-span-2" placeholder="Equipment, comma separated" />
                <SubmitButton className="btn btn-primary btn-sm col-span-2">Save room</SubmitButton>
              </ActionForm>
            </details>
          ) : null
        }
      />
      {sp.msg && <div className="mb-4 border border-hairline-2 bg-elevated px-4 py-3 text-ink text-[13px]">{sp.msg}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Stat label="Rooms" value={rooms.length} hint={`${new Set(rooms.map((r) => r.building)).size} buildings · ${rooms.reduce((a, r) => a + r.capacity, 0)} seats`} />
        <Stat label="Slot utilisation" value={`${Math.round(overall * 100)}%`} hint="room-slots used per week" />
        <Stat label="Seat utilisation" value={`${Math.round((seatHours / seatCapacityHours) * 100)}%`} hint="student-hours ÷ seat-hours" />
        <Stat label="Idle rooms" value={rows.filter((x) => x.util < 0.15).length} tone="warn" hint="under 15% weekly use" />
      </div>

      <Card title="Availability finder" subtitle="Which rooms are free at a given time?" className="mb-4">
        <form method="get" className="grid md:grid-cols-[160px_160px_160px_auto] gap-3">
          <select name="day" className="input input-sm" defaultValue={day ?? ""}>
            <option value="">Day…</option>
            {[0, 1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                {DAY_NAMES[d]}
              </option>
            ))}
          </select>
          <select name="hour" className="input input-sm" defaultValue={hour ?? ""}>
            <option value="">Hour…</option>
            {Array.from({ length: 10 }, (_, i) => 7 + i).map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <input name="min" type="number" className="input input-sm" placeholder="Min capacity" defaultValue={sp.min ?? ""} />
          <button className="btn btn-outline btn-sm">Find free rooms</button>
        </form>
        {finder && (
          <div className="mt-4 flex flex-wrap gap-2">
            {finder.length === 0 && <span className="text-danger text-[13px]">No rooms free at that time with that capacity.</span>}
            {finder.map((x) => (
              <Link key={x.r.id} href={`/rooms/${x.r.id}`} className="pill bg-[rgba(3,144,74,0.18)] text-[#39c27c]">
                {x.r.code} · {x.r.capacity}
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card pad={false} title="Inventory & utilisation">
        <table className="table">
          <thead>
            <tr>
              <th>Room</th>
              <th>Building</th>
              <th>Type</th>
              <th>Capacity</th>
              <th>Exam grid</th>
              <th className="w-56">Weekly utilisation</th>
              <th>Avg fill</th>
              <th>Equipment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, used, util, fill, equipment }) => (
              <tr key={r.id} className={r.active ? "" : "opacity-50"}>
                <td className="ink">
                  <Link href={`/rooms/${r.id}`} className="hover:underline">
                    {r.code}
                  </Link>
                  <div className="text-[11px] text-muted">{r.name}</div>
                </td>
                <td>{r.building}</td>
                <td>
                  <Pill>{r.type}</Pill>
                </td>
                <td className="num">{r.capacity}</td>
                <td className="num text-muted">
                  {r.rows}×{r.cols}
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Bar value={util * 100} tone={util > 0.7 ? "warn" : util < 0.15 ? "rosso" : "info"} />
                    </div>
                    <span className="num text-[12px] w-16 text-right">
                      {used}h · {Math.round(util * 100)}%
                    </span>
                  </div>
                </td>
                <td className="num">{used ? `${Math.round(fill * 100)}%` : "—"}</td>
                <td className="text-[11px] text-muted">{equipment.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
