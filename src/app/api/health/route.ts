import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const [students, sessions, exams] = await Promise.all([prisma.student.count(), prisma.timetableSession.count(), prisma.examSession.count()]);
  return NextResponse.json({ ok: true, students, sessions, exams, ai: Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY) });
}
