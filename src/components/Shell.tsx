import Link from "next/link";
import type { ReactNode } from "react";
import { LayoutDashboard, Users, ClipboardCheck, CalendarRange, GraduationCap, Briefcase, DoorOpen, Sparkles, ScrollText, UserCircle, LogOut } from "lucide-react";
import type { CurrentUser } from "@/lib/auth";
import { ROLE_LABEL, type Role } from "@/lib/constants";
import { logout } from "@/app/login/actions";
import { NavLinks } from "./NavLinks";
import { ChatWidget } from "./ChatWidget";
import { Toaster } from "./Toaster";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; roles: Role[] };

export const ICONS = { LayoutDashboard, Users, ClipboardCheck, CalendarRange, GraduationCap, Briefcase, DoorOpen, Sparkles, ScrollText, UserCircle };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", roles: ["ADMIN", "RTE_STAFF", "LECTURER"] },
  { href: "/students", label: "Students", icon: "Users", roles: ["ADMIN", "RTE_STAFF", "LECTURER"] },
  { href: "/results", label: "Results", icon: "ClipboardCheck", roles: ["ADMIN", "RTE_STAFF", "LECTURER"] },
  { href: "/timetable", label: "Timetable", icon: "CalendarRange", roles: ["ADMIN", "RTE_STAFF", "LECTURER"] },
  { href: "/exams", label: "Examinations", icon: "GraduationCap", roles: ["ADMIN", "RTE_STAFF", "LECTURER"] },
  { href: "/faculty", label: "Faculty", icon: "Briefcase", roles: ["ADMIN", "RTE_STAFF", "LECTURER"] },
  { href: "/rooms", label: "Rooms", icon: "DoorOpen", roles: ["ADMIN", "RTE_STAFF", "LECTURER"] },
  { href: "/assistant", label: "Assistant", icon: "Sparkles", roles: ["ADMIN", "RTE_STAFF", "LECTURER"] },
  { href: "/audit", label: "Audit trail", icon: "ScrollText", roles: ["ADMIN", "RTE_STAFF"] },
  { href: "/me", label: "My portal", icon: "UserCircle", roles: ["STUDENT", "LECTURER"] },
];

export function Shell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const items = NAV.filter((n) => n.roles.includes(user.role));
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="no-print border-r border-hairline bg-canvas lg:sticky lg:top-0 lg:h-screen flex flex-col">
        <div className="h-16 flex items-center gap-3 px-6 border-b border-hairline">
          <span className="inline-block h-6 w-1.5 bg-rosso" />
          <div>
            <div className="text-ink font-semibold tracking-wide text-[14px]">RTE HUB</div>
            <div className="text-muted text-[10px] uppercase tracking-[1px]">Islington College</div>
          </div>
        </div>
        <NavLinks items={items} />
        <div className="mt-auto border-t border-hairline p-4">
          <div className="text-ink text-[13px] font-medium truncate">{user.name}</div>
          <div className="caps mt-0.5">{ROLE_LABEL[user.role]}</div>
          <form action={logout} className="mt-3">
            <button className="btn btn-ghost btn-sm px-0 gap-2" type="submit">
              <LogOut size={14} /> Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        <main className="mx-auto max-w-[1360px] px-6 lg:px-10 py-8">{children}</main>
        <footer className="px-10 py-6 text-[11px] text-muted border-t border-hairline no-print">
          RTE Hub · Islington College Routine, Timetable &amp; Examination Department · Prototype for Islington Hackathon 2026
        </footer>
      </div>
      <ChatWidget />
      <Toaster />
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="caps hover:text-ink inline-flex items-center gap-1 mb-4">
      ← {children}
    </Link>
  );
}
