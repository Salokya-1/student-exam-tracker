// Permission matrix (safe to import from client or server code).
import type { Role } from "./constants";

const MATRIX: Record<string, Role[]> = {
  "results:enter": ["ADMIN", "RTE_STAFF", "LECTURER"],
  "results:approve": ["ADMIN", "RTE_STAFF"],
  "results:publish": ["ADMIN"],
  "timetable:edit": ["ADMIN", "RTE_STAFF"],
  "exams:edit": ["ADMIN", "RTE_STAFF"],
  "rooms:edit": ["ADMIN", "RTE_STAFF"],
  "students:view": ["ADMIN", "RTE_STAFF", "LECTURER"],
  "audit:view": ["ADMIN", "RTE_STAFF"],
  "records:manage": ["ADMIN", "RTE_STAFF"],
  "users:manage": ["ADMIN"],
};

export function can(role: Role, action: string): boolean {
  return (MATRIX[action] ?? []).includes(role);
}
