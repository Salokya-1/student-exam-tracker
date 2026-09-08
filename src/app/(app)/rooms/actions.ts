"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, can } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { ActionResult } from "@/components/ActionForm";

export async function saveRoom(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!can(user.role, "rooms:edit")) return { ok: false, message: "Your role cannot edit rooms" };
  const id = String(formData.get("id") ?? "");
  const data = {
    code: String(formData.get("code")).trim().toUpperCase(),
    name: String(formData.get("name")).trim(),
    building: String(formData.get("building")).trim(),
    type: String(formData.get("type")),
    capacity: Number(formData.get("capacity")),
    rows: Number(formData.get("rows") || 6),
    cols: Number(formData.get("cols") || 8),
    equipment: JSON.stringify(
      String(formData.get("equipment") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    active: id ? formData.get("active") === "on" : true,
  };
  if (!data.code || !data.name || !data.capacity) return { ok: false, message: "Code, name and capacity are required" };
  try {
    const room = id ? await prisma.room.update({ where: { id }, data }) : await prisma.room.create({ data });
    await audit(user.id, id ? "ROOM_UPDATED" : "ROOM_CREATED", "Room", room.id, data);
    revalidatePath("/rooms");
    revalidatePath(`/rooms/${room.id}`);
    return { ok: true, message: `Room ${room.code} saved`, redirectTo: id ? undefined : `/rooms/${room.id}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message.includes("Unique") ? `Room code ${data.code} already exists` : "Could not save room" };
  }
}
