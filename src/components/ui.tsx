import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
      <div>
        {eyebrow && <div className="caps mb-2">{eyebrow}</div>}
        <h1 className="text-[28px] leading-tight">{title}</h1>
        {description && <p className="mt-2 text-body max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 no-print">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "", title, subtitle, actions, pad = true }: { children: ReactNode; className?: string; title?: string; subtitle?: string; actions?: ReactNode; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-4 px-6 py-4 border-b border-hairline">
          <div>
            {title && <h3 className="text-[15px] font-medium text-ink">{title}</h3>}
            {subtitle && <p className="text-[12px] text-muted mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={pad ? "card-pad" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default", href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "danger" | "success" | "warn" | "info"; href?: string }) {
  const color = { default: "text-ink", danger: "text-danger", success: "text-success", warn: "text-warn", info: "text-info" }[tone];
  const body = (
    <div className="card card-pad h-full">
      <div className="caps">{label}</div>
      <div className={`mt-3 text-[34px] leading-none font-medium num ${color}`}>{value}</div>
      {hint && <div className="mt-3 text-[12px] text-muted">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

type Tone = "neutral" | "success" | "warn" | "danger" | "info" | "rosso";
const toneCls: Record<Tone, string> = {
  neutral: "bg-elevated-3 text-ink",
  success: "bg-[rgba(3,144,74,0.18)] text-[#39c27c]",
  warn: "bg-[rgba(232,163,61,0.18)] text-[#f0b455]",
  danger: "bg-[rgba(241,58,44,0.18)] text-[#ff6b60]",
  info: "bg-[rgba(76,152,185,0.18)] text-[#7cc0dc]",
  rosso: "bg-rosso text-white",
};

export function Pill({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={`pill ${toneCls[tone]} ${className}`}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "warn",
  PUBLISHED: "success",
  PLANNED: "neutral",
  VENUES_ALLOCATED: "info",
  SEATED: "warn",
  READY: "success",
  COMPLETED: "neutral",
  GOOD: "success",
  AT_RISK: "warn",
  PROBATION: "danger",
  WITHDRAWN: "neutral",
  HIGH: "danger",
  MEDIUM: "warn",
  LOW: "info",
  ERROR: "danger",
  WARNING: "warn",
  PASSED: "success",
  FAILED: "danger",
  PENDING: "warn",
  ACTIVE: "info",
  RESIT: "warn",
  PROGRESS: "success",
  PROGRESS_WITH_RESIT: "warn",
  REPEAT: "danger",
  REVIEW: "info",
  ARCHIVED: "neutral",
  CHIEF: "rosso",
  ASSISTANT: "neutral",
};

export function Status({ value }: { value: string }) {
  return <Pill tone={STATUS_TONE[value] ?? "neutral"}>{value.replace(/_/g, " ")}</Pill>;
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="py-12 text-center">
      <div className="text-ink font-medium">{title}</div>
      {body && <p className="text-muted text-[13px] mt-1">{body}</p>}
    </div>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-6 py-2 border-b border-hairline last:border-b-0">
      <span className="text-muted text-[12px] uppercase tracking-wide">{k}</span>
      <span className="text-ink text-right">{v}</span>
    </div>
  );
}

export function Bar({ value, max = 100, tone = "info" }: { value: number; max?: number; tone?: "info" | "success" | "warn" | "danger" | "rosso" }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bg = { info: "bg-info", success: "bg-success", warn: "bg-warn", danger: "bg-danger", rosso: "bg-rosso" }[tone];
  return (
    <div className="h-1.5 w-full bg-elevated-3">
      <div className={`h-full ${bg}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function LinkButton({ href, children, variant = "outline", className = "" }: { href: string; children: ReactNode; variant?: "primary" | "outline" | "ghost"; className?: string }) {
  return (
    <Link href={href} className={`btn btn-${variant} ${className}`}>
      {children}
    </Link>
  );
}
