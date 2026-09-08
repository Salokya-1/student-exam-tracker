"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, can } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { loadSheet } from "@/lib/data/results";
import { transitionResultSheet } from "@/lib/services/results";
import type { ActionResult } from "@/components/ActionForm";

export type MarkEntry = { enrollmentId: string; assessmentId: string; marks: number | null };

export async function saveMarks(sheetId: string, entries: MarkEntry[]) {
  const user = await requireUser();
  if (!can(user.role, "results:enter")) return { ok: false, error: "Not permitted" };
  const sheet = await prisma.resultSheet.findUnique({ where: { id: sheetId } });
  if (!sheet) return { ok: false, error: "Sheet not found" };
  if (sheet.status !== "DRAFT") return { ok: false, error: "Only DRAFT sheets can be edited. Ask an administrator to reopen it." };
  let changed = 0;
  await prisma.$transaction(
    entries.map((e) =>
      prisma.mark.upsert({
        where: { sheetId_enrollmentId_assessmentId: { sheetId, enrollmentId: e.enrollmentId, assessmentId: e.assessmentId } },
        update: { marks: e.marks },
        create: { sheetId, enrollmentId: e.enrollmentId, assessmentId: e.assessmentId, marks: e.marks },
      }),
    ),
  );
  changed = entries.length;
  await audit(user.id, "MARKS_SAVED", "ResultSheet", sheetId, { changed });
  revalidatePath(`/results/${sheetId}`);
  return { ok: true, changed };
}

export async function importCsv(sheetId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user.role, "results:enter")) return { ok: false, message: "Not permitted" };
  const data = await loadSheet(sheetId);
  if (!data) return { ok: false, message: "Sheet not found" };
  if (data.sheet.status !== "DRAFT") return { ok: false, message: "Sheet is not in DRAFT" };
  const file = formData.get("file");
  const pasted = String(formData.get("csv") ?? "");
  const text = file instanceof File && file.size > 0 ? await file.text() : pasted;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { ok: false, message: "CSV has no data rows" };
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const noIdx = header.findIndex((h) => ["studentno", "student_no", "student no", "id", "student"].includes(h));
  if (noIdx < 0) return { ok: false, message: "CSV needs a studentNo column" };
  const colFor = new Map<string, number>();
  for (const a of data.assessments) {
    const idx = header.findIndex((h) => h === a.name.toLowerCase() || h === a.name.slice(0, 2).toLowerCase() || h.startsWith(a.name.toLowerCase().slice(0, 4)));
    if (idx >= 0) colFor.set(a.id, idx);
  }
  if (!colFor.size) return { ok: false, message: `CSV needs columns: ${data.assessments.map((a) => a.name).join(", ")}` };
  const byNo = new Map(data.rows.map((r) => [r.studentNo, r]));
  const entries: MarkEntry[] = [];
  const unknown: string[] = [];
  const invalid: string[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    const row = byNo.get(cells[noIdx]);
    if (!row) {
      unknown.push(cells[noIdx]);
      continue;
    }
    for (const [aid, idx] of colFor) {
      const raw = cells[idx];
      if (raw === undefined || raw === "") {
        entries.push({ enrollmentId: row.enrollmentId, assessmentId: aid, marks: null });
        continue;
      }
      const n = Number(raw);
      if (Number.isNaN(n)) {
        invalid.push(`${cells[noIdx]}:${raw}`);
        continue;
      }
      entries.push({ enrollmentId: row.enrollmentId, assessmentId: aid, marks: n });
    }
  }
  await prisma.$transaction(
    entries.map((e) =>
      prisma.mark.upsert({
        where: { sheetId_enrollmentId_assessmentId: { sheetId, enrollmentId: e.enrollmentId, assessmentId: e.assessmentId } },
        update: { marks: e.marks },
        create: { sheetId, enrollmentId: e.enrollmentId, assessmentId: e.assessmentId, marks: e.marks },
      }),
    ),
  );
  await audit(user.id, "MARKS_IMPORTED", "ResultSheet", sheetId, { rows: lines.length - 1, entries: entries.length, unknown, invalid });
  const msg = `Imported ${entries.length} marks from ${lines.length - 1} rows${unknown.length ? ` · ${unknown.length} unknown student(s) skipped` : ""}${invalid.length ? ` · ${invalid.length} non-numeric value(s) skipped` : ""}`;
  revalidatePath(`/results/${sheetId}`);
  return { ok: true, message: msg };
}

export async function transitionSheet(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const sheetId = String(formData.get("sheetId"));
  const op = String(formData.get("op"));
  const note = String(formData.get("note") ?? "").trim();
  const r = await transitionResultSheet(sheetId, op, note, user);
  revalidatePath(`/results/${sheetId}`);
  revalidatePath("/results");
  revalidatePath("/dashboard");
  if (!r.ok) return { ok: false, message: r.error };
  const fx = r.effects ? ` · ${r.effects.failed} fail(s), ${r.effects.resits} resit(s) created, ${r.effects.progressions} progression decision(s)` : "";
  return { ok: true, message: `${r.module} ${r.cohort} is now ${r.status}${fx}` };
}
