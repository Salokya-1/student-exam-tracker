import { NextResponse } from "next/server";
import { loadSheet } from "@/lib/data/results";
import { getCurrentUser } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role === "STUDENT") return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const data = await loadSheet(id);
  if (!data) return new NextResponse("Not found", { status: 404 });
  const header = ["studentNo", "name", ...data.assessments.map((a) => a.name)].join(",");
  const lines = data.rows.map((r) => [r.studentNo, `"${r.name}"`, ...data.assessments.map((a) => r.marks[a.id] ?? "")].join(","));
  return new NextResponse([header, ...lines].join("\n"), {
    headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${data.sheet.module.code}-${data.sheet.cohort.code}-marks.csv"` },
  });
}
