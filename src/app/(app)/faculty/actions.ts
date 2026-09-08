"use server";

import { revalidatePath } from "next/cache";
import { requireUser, can } from "@/lib/auth";
import { reassignAssignment } from "@/lib/services/faculty";
import type { ActionResult } from "@/components/ActionForm";

export async function reassignLecturer(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user.role, "timetable:edit")) return { ok: false, message: "Your role cannot change allocations" };
  const r = await reassignAssignment(String(formData.get("assignmentId")), String(formData.get("lecturerId")), user.id);
  if (!r.ok) return { ok: false, message: r.error };
  revalidatePath("/faculty");
  revalidatePath("/timetable");
  return { ok: true, message: `${r.module} ${r.sessionType.toLowerCase()} for ${r.cohort} moved from ${r.from} to ${r.to} · ${r.sessionsUpdated} timetable session(s) updated`, redirectTo: `/faculty/${r.toId}` };
}
