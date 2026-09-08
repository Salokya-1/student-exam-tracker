import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { SESSION_COOKIE, signSession, verifySession, type SessionPayload } from "./session";
import type { Role } from "./constants";

export { hashPassword, verifyPassword } from "./password";

// ── Session ──
export async function createSession(user: { id: string; role: string; name: string }) {
  const token = await signSession({ uid: user.id, role: user.role as Role, name: user.name });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  lecturerId: string | null;
  studentId: string | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const s = await getSession();
  if (!s) return null;
  const u = await prisma.user.findUnique({
    where: { id: s.uid },
    select: { id: true, email: true, name: true, role: true, lecturerId: true, studentId: true },
  });
  if (!u) return null;
  return { ...u, role: u.role as Role };
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const u = await requireUser();
  if (!roles.includes(u.role)) redirect("/forbidden");
  return u;
}

export { can } from "./rbac";
