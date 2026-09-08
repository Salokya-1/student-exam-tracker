import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ChatPanel } from "@/components/ChatPanel";
import { aiConfigured, aiModel } from "@/lib/agent/run";
import { toolsForRole } from "@/lib/agent/tools";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const user = await requireUser();
  const tools = toolsForRole(user.role);
  const reads = tools.filter((t) => t.kind === "read");
  const actions = tools.filter((t) => t.kind === "action");
  return (
    <>
      <PageHeader
        eyebrow="AI operations assistant"
        title="RTE Assistant"
        description="Chat naturally. The assistant reads live records and performs real operations through the same audited services the interface uses, limited to what your role may do."
      />
      <div className="grid xl:grid-cols-[1fr_320px] gap-4">
        <div className="card h-[calc(100vh-260px)] min-h-[520px] flex flex-col">
          <ChatPanel />
        </div>
        <div className="space-y-4">
          <div className="card card-pad text-[12px] text-muted">
            <div className="caps mb-2">Engine</div>
            {aiConfigured() ? (
              <p>
                Experiential Labs gateway · model <span className="text-ink">{aiModel()}</span> with function calling. Facts and actions always come from the system; the model plans and explains. Falls back to the rule engine if the gateway is unreachable.
              </p>
            ) : (
              <p>
                Rule engine only. Set <code>AI_BASE_URL</code>, <code>AI_API_KEY</code>, <code>AI_MODEL</code> in <code>.env</code> to enable the LLM.
              </p>
            )}
          </div>
          <div className="card card-pad">
            <div className="caps mb-2">Can look up ({reads.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {reads.map((t) => (
                <span key={t.name} className="pill bg-elevated-3 text-body" title={t.description}>
                  {t.name.replace(/_/g, " ")}
                </span>
              ))}
            </div>
            <div className="caps mb-2 mt-4">Can do for you ({actions.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {actions.map((t) => (
                <span key={t.name} className="pill bg-[rgba(218,41,28,0.16)] text-[#ff8a80]" title={t.description}>
                  {t.name.replace(/_/g, " ")}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-muted mt-4">Every action is role-checked and written to the audit trail, exactly like a click in the UI. Press Ctrl+K anywhere to open the floating assistant.</p>
          </div>
        </div>
      </div>
    </>
  );
}
