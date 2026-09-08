import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; q?: string; page?: string }> }) {
  await requireRole("ADMIN", "RTE_STAFF");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const take = 50;
  const where = { ...(sp.entity ? { entity: sp.entity } : {}), ...(sp.q ? { OR: [{ action: { contains: sp.q.toUpperCase() } }, { details: { contains: sp.q } }, { user: { name: { contains: sp.q } } }] } : {}) };
  const [logs, total, entities] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { user: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * take, take }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({ by: ["entity"], _count: { _all: true } }),
  ]);
  return (
    <>
      <PageHeader eyebrow="Governance" title="Audit trail" description="Every important scheduling, examination and result change with who did it, when, and the details — the traceability manual spreadsheets never had." />
      <Card pad={false}>
        <form method="get" className="grid md:grid-cols-[1fr_200px_auto] gap-3 p-4 border-b border-hairline">
          <input name="q" className="input" placeholder="Search action, user or details…" defaultValue={sp.q ?? ""} />
          <select name="entity" className="input" defaultValue={sp.entity ?? ""}>
            <option value="">All entities</option>
            {entities.map((e) => (
              <option key={e.entity} value={e.entity}>
                {e.entity} ({e._count._all})
              </option>
            ))}
          </select>
          <button className="btn btn-outline">Filter</button>
        </form>
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap text-[12px]">{l.createdAt.toLocaleString("en-GB")}</td>
                <td className="ink">{l.user?.name ?? "system"}</td>
                <td>
                  <Pill>{l.action.replace(/_/g, " ")}</Pill>
                </td>
                <td className="text-[12px]">
                  {l.entity} <span className="text-muted">{l.entityId?.slice(0, 18)}</span>
                </td>
                <td className="text-[11px] text-muted font-mono max-w-[480px] truncate" title={l.details ?? ""}>
                  {l.details}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-hairline text-[12px] text-muted flex justify-between">
          <span>
            {total} entries · page {page} of {Math.max(1, Math.ceil(total / take))}
          </span>
          <span className="flex gap-3">
            {page > 1 && <a href={`/audit?page=${page - 1}&entity=${sp.entity ?? ""}&q=${sp.q ?? ""}`}>← Prev</a>}
            {page * take < total && <a href={`/audit?page=${page + 1}&entity=${sp.entity ?? ""}&q=${sp.q ?? ""}`}>Next →</a>}
          </span>
        </div>
      </Card>
    </>
  );
}
