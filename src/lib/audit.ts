import { prisma } from "./prisma";

export async function audit(
  userId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
  details?: unknown,
) {
  await prisma.auditLog.create({
    data: {
      userId: userId ?? undefined,
      action,
      entity,
      entityId: entityId ?? undefined,
      details: details === undefined ? undefined : JSON.stringify(details),
    },
  });
}
