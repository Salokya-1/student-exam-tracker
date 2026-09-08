// Shared domain constants & helpers (enums are stored as strings in SQLite)

export const ROLES = ["ADMIN", "RTE_STAFF", "LECTURER", "STUDENT"] as const;
export type Role = (typeof ROLES)[number];

export const SHEET_STATUS = ["DRAFT", "SUBMITTED", "APPROVED", "PUBLISHED"] as const;
export type SheetStatus = (typeof SHEET_STATUS)[number];

export const EXAM_STATUS = ["PLANNED", "VENUES_ALLOCATED", "SEATED", "READY", "COMPLETED"] as const;
export type ExamStatus = (typeof EXAM_STATUS)[number];

export const ROOM_TYPES = ["LECTURE", "LAB", "SEMINAR", "HALL"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const SESSION_TYPES = ["LECTURE", "TUTORIAL", "LAB"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

/** Academic terms used by the demo data */
export const TERMS = {
  previous: "2025-AUT", // fully published
  processing: "2026-SPR", // results being processed now
  current: "2026-AUT", // teaching term being timetabled; exams being planned
} as const;

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const TEACHING_DAYS = [0, 1, 2, 3, 4, 5]; // Islington College runs Sunday–Friday

export function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function timeRange(start: number, end: number): string {
  return `${minToTime(start)}–${minToTime(end)}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

export function seatLabel(row: number, col: number): string {
  return `${String.fromCharCode(64 + row)}${col}`;
}

/** Deterministic PRNG (mulberry32) so demo data & scheduling are reproducible */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrator",
  RTE_STAFF: "RTE Officer",
  LECTURER: "Lecturer",
  STUDENT: "Student",
};
