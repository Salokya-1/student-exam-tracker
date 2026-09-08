"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, can } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateTimetableOption, publishTimetableById, deleteTimetableById, autoResolveTimetable, saveSessionRecord, type SessionInput } from "@/lib/services/timetable";
import type { ActionResult } from "@/components/ActionForm";

export type { SessionInput } from "@/lib/services/timetable";

const denied: ActionResult = { ok: false, message: "Your role cannot edit timetables" };

async function editor() {
  const user = await requireUser();
  return can(user.role, "timetable:edit") ? user : null;
}

export async function generateAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await editor();
  if (!user) return denied;
  const r = await generateTimetableOption(
    {
      name: String(formData.get("name") || ""),
      seed: Number(formData.get("seed") || 42),
      maxLecturerDaily: Number(formData.get("maxLecturerDaily") || 4),
      maxCohortDaily: Number(formData.get("maxCohortDaily") || 6),
      improvementPasses: Number(formData.get("passes") || 2),
      keepLocked: formData.get("keepLocked") === "on",
    },
    user.id,
  );
  revalidatePath("/timetable");
  return { ok: true, message: `Solver placed ${r.stats.placed}/${r.stats.units} sessions in ${r.ms} ms (score ${r.score})`, redirectTo: `/timetable?tt=${r.timetableId}&report=1` };
}

export async function publishTimetable(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await editor();
  if (!user) return denied;
  const r = await publishTimetableById(String(formData.get("id")), user.id);
  revalidatePath("/timetable");
  revalidatePath("/dashboard");
  return r.ok ? { ok: true, message: `"${r.name}" published — previous version archived` } : { ok: false, message: r.error };
}

export async function deleteTimetable(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await editor();
  if (!user) return denied;
  const r = await deleteTimetableById(String(formData.get("id")), user.id);
  revalidatePath("/timetable");
  return r.ok ? { ok: true, message: `Deleted "${r.name}"`, redirectTo: "/timetable" } : { ok: false, message: r.error };
}

export async function autoResolve(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await editor();
  if (!user) return denied;
  const r = await autoResolveTimetable(String(formData.get("id")), user.id);
  revalidatePath("/timetable");
  return r.ok ? { ok: r.after === 0, message: `Auto-resolve moved ${r.moved} session(s); ${r.after} hard conflict(s) remain` } : { ok: false, message: r.error };
}

export async function saveSession(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await editor();
  if (!user) return denied;
  const input: SessionInput = {
    id: String(formData.get("id") || "") || undefined,
    timetableId: String(formData.get("timetableId")),
    moduleId: String(formData.get("moduleId")),
    cohortId: String(formData.get("cohortId")),
    lecturerId: String(formData.get("lecturerId")),
    roomId: String(formData.get("roomId")),
    slotId: String(formData.get("slotId")),
    sessionType: String(formData.get("sessionType")),
  };
  const r = await saveSessionRecord(input, { override: formData.get("override") === "on", locked: formData.get("locked") === "on" }, user.id);
  if (!r.ok) return { ok: false, message: `${r.error}. Tick "override" to force (recorded in audit).` };
  revalidatePath("/timetable");
  return { ok: true, message: r.override ? "Session saved with conflict override" : "Session saved — no conflicts", redirectTo: `/timetable?tt=${input.timetableId}` };
}

export async function deleteSession(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await editor();
  if (!user) return denied;
  const id = String(formData.get("id"));
  const s = await prisma.timetableSession.findUnique({ where: { id }, include: { module: true, cohort: true } });
  if (!s) return { ok: false, message: "Session not found" };
  await prisma.timetableSession.delete({ where: { id } });
  await audit(user.id, "SESSION_DELETED", "TimetableSession", id, { module: s.module.code, cohort: s.cohort.code });
  revalidatePath("/timetable");
  return { ok: true, message: "Session removed", redirectTo: `/timetable?tt=${s.timetableId}` };
}
