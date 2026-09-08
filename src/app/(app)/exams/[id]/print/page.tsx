import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, timeRange } from "@/lib/constants";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

export default async function PrintSeating({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN", "RTE_STAFF", "LECTURER");
  const { id } = await params;
  const exam = await prisma.examSession.findUnique({
    where: { id },
    include: { module: true, venues: { include: { room: true } }, invigilations: { include: { lecturer: true, room: true } }, seats: { include: { student: { include: { cohort: true } }, room: true }, orderBy: [{ roomId: "asc" }, { seatNo: "asc" }] } },
  });
  if (!exam) notFound();
  return (
    <div className="bg-white text-black p-8 print-ink" style={{ color: "#000" }}>
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-widest">Islington College · RTE Department · Examination Seating Plan</div>
          <h1 className="text-[24px] font-semibold mt-1" style={{ color: "#000" }}>
            {exam.module.code} — {exam.module.name}
          </h1>
          <div className="text-[13px] mt-1">
            {fmtDate(exam.date)} · {timeRange(exam.startMin, exam.endMin)} · {exam.seats.length} candidates · Venues: {exam.venues.map((v) => v.room.code).join(", ")}
          </div>
        </div>
        <PrintButton />
      </div>
      {exam.venues.map((v) => {
        const seats = exam.seats.filter((s) => s.roomId === v.roomId);
        const inv = exam.invigilations.filter((i) => i.roomId === v.roomId);
        return (
          <section key={v.id} className="mb-8 break-inside-avoid">
            <h2 className="text-[16px] font-semibold border-b border-black pb-1 mb-2" style={{ color: "#000" }}>
              {v.room.code} · {v.room.name} — {seats.length} candidates
              <span className="font-normal text-[12px] ml-3">Invigilators: {inv.map((i) => `${i.lecturer.name} (${i.role.toLowerCase()})`).join(", ") || "TBA"}</span>
            </h2>
            <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Seat", "No.", "Student no.", "Name", "Group", "Signature"].map((h) => (
                    <th key={h} className="text-left py-1 px-2" style={{ border: "1px solid #999" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {seats.map((s) => (
                  <tr key={s.id}>
                    <td className="py-1 px-2 font-semibold" style={{ border: "1px solid #999" }}>{s.label}</td>
                    <td className="py-1 px-2" style={{ border: "1px solid #999" }}>{s.seatNo}</td>
                    <td className="py-1 px-2" style={{ border: "1px solid #999" }}>{s.student.studentNo}</td>
                    <td className="py-1 px-2" style={{ border: "1px solid #999" }}>{s.student.firstName} {s.student.lastName}</td>
                    <td className="py-1 px-2" style={{ border: "1px solid #999" }}>{s.student.cohort.code}</td>
                    <td className="py-1 px-2" style={{ border: "1px solid #999" }}></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
