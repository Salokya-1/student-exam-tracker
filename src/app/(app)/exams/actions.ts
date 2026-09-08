"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, can } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { allocateVenuesFor, assignInvigilatorsFor, createExamRecord, generateSeatingFor } from "@/lib/services/exams";
import type { ActionResult } from "@/components/ActionForm";

const denied: ActionResult = { ok: false, message: "Your role cannot manage examinations" };

async function editor() {
  const user = await requireUser();
  return can(user.role, "exams:edit") ? user : null;
}

function refresh(examId: string) {
  revalidatePath(`/exams/${examId}`);
  revalidatePath("/exams");
  revalidatePath("/dashboard");
}

export async function createExam(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await editor();
  if (!user) return denied;
  const mod = await prisma.module.findUnique({ where: { id: String(formData.get("moduleId")) } });
  const cohorts = await prisma.cohort.findMany({ where: { id: { in: formData.getAll("cohortIds").map(String) } } });
  if (!mod || !cohorts.length || !formData.get("date")) return { ok: false, message: "Module, date and at least one group are required" };
  const r = await createExamRecord({ moduleCode: mod.code, date: String(formData.get("date")), startMin: Number(formData.get("startMin")), duration: Number(formData.get("duration") || 120), cohortCodes: cohorts.map((c) => c.code) }, user.id);
  if (!r.ok) return { ok: false, message: r.error };
  revalidatePath("/exams");
  return { ok: true, message: `${r.module} exam scheduled for ${r.cohorts.join(", ")}`, redirectTo: `/exams/${r.examId}` };
}

export async function allocateVenues(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await editor();
  if (!user) return denied;
  const examId = String(formData.get("examId"));
  const mode = String(formData.get("mode") ?? "manual") === "auto" ? "auto" : "manual";
  const r = await allocateVenuesFor(examId, mode, formData.getAll("roomIds").map(String), user.id);
  refresh(examId);
  return r.ok ? { ok: true, message: `${r.rooms.length} venue(s) allocated (${r.rooms.join(", ")}) for ${r.students} students — capacity ${r.capacity}` } : { ok: false, message: r.error };
}

export async function generateSeatingAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await editor();
  if (!user) return denied;
  const examId = String(formData.get("examId"));
  const r = await generateSeatingFor(examId, user.id);
  refresh(examId);
  return r.ok
    ? { ok: r.unseated === 0, message: `Seated ${r.seated} of ${r.total} students across ${r.venues.length} venue(s)${r.unseated ? ` — ${r.unseated} unseated (add capacity)` : ""} · ${r.adjacencyConflicts} same-paper neighbours` }
    : { ok: false, message: r.error };
}

export async function assignInvigilatorsAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await editor();
  if (!user) return denied;
  const examId = String(formData.get("examId"));
  const r = await assignInvigilatorsFor(examId, user.id);
  refresh(examId);
  return r.ok
    ? { ok: r.ready, message: `${r.assigned.length} invigilator(s) assigned${r.shortfall.length ? ` — short by ${r.shortfall.reduce((a, s) => a + s.missing, 0)}` : " — exam is READY"}` }
    : { ok: false, message: r.error };
}

export async function setExamStatus(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await editor();
  if (!user) return denied;
  const examId = String(formData.get("examId"));
  const status = String(formData.get("status"));
  await prisma.examSession.update({ where: { id: examId }, data: { status } });
  await audit(user.id, "EXAM_STATUS", "ExamSession", examId, { status });
  refresh(examId);
  return { ok: true, message: `Status set to ${status}` };
}

export async function deleteExam(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await editor();
  if (!user) return denied;
  const examId = String(formData.get("examId"));
  await prisma.examSession.delete({ where: { id: examId } });
  await audit(user.id, "EXAM_DELETED", "ExamSession", examId);
  revalidatePath("/exams");
  return { ok: true, message: "Exam deleted", redirectTo: "/exams" };
}
