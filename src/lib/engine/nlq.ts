// Natural-language academic query engine.
// A deterministic intent router (regex + entity matching) answers operational
// questions directly from the database. When an LLM provider is configured
// (see ai.ts) the model is only used to classify the intent / extract entities
// and to phrase the answer — the data always comes from these handlers, so
// answers cannot be hallucinated.

import { prisma } from "../prisma";
import { DAY_NAMES, TERMS, fmtDate, minToTime, timeRange } from "../constants";
import { getPublishedTimetable, loadSessions, lecturerLimits } from "../data/timetable";
import { detectClashes, clashLabel } from "./clash";
import { loadSheet } from "../data/results";
import { atRiskStudents } from "../data/analytics";

export type NlqAnswer = {
  intent: string;
  answer: string;
  rows?: { columns: string[]; data: (string | number)[][] };
  links?: { label: string; href: string }[];
};

export const INTENTS = [
  { name: "seat_lookup", description: "Where a student sits in an exam. params: student (number or name)" },
  { name: "timetable", description: "Timetable/schedule for a student group, lecturer or room, optionally on a day. params: entity, day" },
  { name: "room_availability", description: "Is a room free / which rooms are free at a day+time, optional min capacity. params: room, day, hour, capacity" },
  { name: "workload", description: "Teaching workload of a lecturer or who is overloaded. params: lecturer" },
  { name: "module_results", description: "Results, average, pass rate, fails for a module (code). params: module" },
  { name: "clashes", description: "Current timetable conflicts" },
  { name: "at_risk", description: "Students at academic risk, optionally in a group. params: cohort" },
  { name: "exam_info", description: "When/where a module's exam is, venues, readiness. params: module" },
  { name: "room_utilisation", description: "Most / least used rooms" },
  { name: "student_profile", description: "Summary of a student's record. params: student" },
  { name: "help", description: "Anything else" },
] as const;

export type Intent = (typeof INTENTS)[number]["name"];
export type Params = { student?: string; entity?: string; day?: string; room?: string; hour?: string; capacity?: string; lecturer?: string; module?: string; cohort?: string };

const DAY_RX = /\b(sun(day)?|mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|today|tomorrow)\b/i;
function dayIndex(word?: string): number | null {
  if (!word) return null;
  const w = word.toLowerCase();
  if (w === "today") return new Date().getDay();
  if (w === "tomorrow") return (new Date().getDay() + 1) % 7;
  const i = DAY_NAMES.findIndex((d) => w.startsWith(d.toLowerCase()));
  return i >= 0 ? i : null;
}
function hourFrom(text: string): number | null {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]?.toLowerCase() === "pm" && h < 12) h += 12;
  if (h >= 7 && h <= 16) return h;
  return null;
}

/** Rule-based classification used when no LLM is configured (or as fallback). */
export function classify(q: string): { intent: Intent; params: Params } {
  const t = q.trim();
  const lower = t.toLowerCase();
  const mod = t.match(/\b([A-Z]{2}\d{4})\b/i)?.[1]?.toUpperCase();
  const cohort = t.match(/\b(L[456][A-Z]{2}G\d)\b/i)?.[1]?.toUpperCase();
  const room = t.match(/\b([A-Z]{2,3}-\d{1,3})\b/i)?.[1]?.toUpperCase();
  const studentNo = t.match(/\b(20\d{6})\b/)?.[1];
  const day = t.match(DAY_RX)?.[0];
  const hour = hourFrom(t);
  const cap = t.match(/\b(\d{2,3})\s*(students|people|seats)\b/i)?.[1];
  const params: Params = { module: mod, cohort, room, day, hour: hour !== null ? String(hour) : undefined, capacity: cap };

  if (/\b(seat|sitting|sit)\b/.test(lower) && (studentNo || /\bwhere\b/.test(lower))) return { intent: "seat_lookup", params: { ...params, student: studentNo ?? nameFrom(t) } };
  if (/\b(free|available|availability|empty|vacant)\b/.test(lower) && (/\broom/.test(lower) || room)) return { intent: "room_availability", params };
  if (/\b(clash|conflict|double.?book|overlap)/.test(lower)) return { intent: "clashes", params };
  if (/\b(at.?risk|struggling|failing students|need support|probation)\b/.test(lower)) return { intent: "at_risk", params };
  if (/\b(workload|overload\w*|contact hours|teaching hours|how many hours)\b/.test(lower)) return { intent: "workload", params: { ...params, lecturer: nameFrom(t) } };
  if (/\b(utili[sz]ation|least used|most used|busiest room|idle rooms?)\b/.test(lower)) return { intent: "room_utilisation", params };
  if (/\bexam/.test(lower) && mod) return { intent: "exam_info", params };
  if (mod && /\b(result|average|mean|pass|fail|grade|marks?)\b/.test(lower)) return { intent: "module_results", params };
  if (studentNo && /\b(profile|record|standing|average|results?)\b/.test(lower)) return { intent: "student_profile", params: { ...params, student: studentNo } };
  if (/\b(timetable|schedule|classes|lectures?|teaching|when (is|does)|what('s| is) on)\b/.test(lower) || cohort || room) {
    return { intent: "timetable", params: { ...params, entity: cohort ?? room ?? mod ?? nameFrom(t) } };
  }
  if (studentNo) return { intent: "student_profile", params: { ...params, student: studentNo } };
  if (mod) return { intent: "module_results", params };
  return { intent: "help", params };
}

function nameFrom(t: string): string | undefined {
  // "Dr. Ramesh Shrestha", "Sunita Maharjan" — two capitalised words (optionally with Dr.)
  const m = t.match(/\b((?:Dr\.?\s+)?[A-Z][a-z]+\s+[A-Z][a-z]+)\b/);
  return m?.[1];
}

export async function execute(intent: Intent, p: Params): Promise<NlqAnswer> {
  switch (intent) {
    case "seat_lookup":
      return seatLookup(p);
    case "timetable":
      return timetable(p);
    case "room_availability":
      return roomAvailability(p);
    case "workload":
      return workload(p);
    case "module_results":
      return moduleResults(p);
    case "clashes":
      return clashes();
    case "at_risk":
      return atRisk(p);
    case "exam_info":
      return examInfo(p);
    case "room_utilisation":
      return roomUtilisation();
    case "student_profile":
      return studentProfile(p);
    default:
      return help();
  }
}

function help(): NlqAnswer {
  return {
    intent: "help",
    answer:
      "I can answer operational questions from live RTE data. Try: “Where is 20250252 sitting?”, “Timetable for L5COG1 on Monday”, “Which rooms are free on Tuesday at 10 for 40 students?”, “Workload of Sunita Maharjan”, “Pass rate for CS4005”, “Any clashes?”, “At-risk students in L6COG1”, “When is the CS5001 exam?”, “Least used rooms”.",
  };
}

async function findStudent(key?: string) {
  if (!key) return null;
  return prisma.student.findFirst({
    where: /^\d+$/.test(key) ? { studentNo: key } : { OR: key.split(/\s+/).map((w) => ({ OR: [{ firstName: { contains: w } }, { lastName: { contains: w } }] })) },
    include: { cohort: true, intake: { include: { programme: true } } },
  });
}

async function seatLookup(p: Params): Promise<NlqAnswer> {
  const s = await findStudent(p.student);
  if (!s) return { intent: "seat_lookup", answer: `I couldn't find a student matching “${p.student ?? "?"}”. Use the 8-digit student number.` };
  const seats = await prisma.seatAllocation.findMany({ where: { studentId: s.id }, include: { exam: { include: { module: true } }, room: true }, orderBy: { exam: { date: "asc" } } });
  if (!seats.length) return { intent: "seat_lookup", answer: `${s.firstName} ${s.lastName} (${s.studentNo}, ${s.cohort.code}) has no seat allocated yet.`, links: [{ label: "Open profile", href: `/students/${s.id}` }] };
  return {
    intent: "seat_lookup",
    answer: `${s.firstName} ${s.lastName} (${s.studentNo}, ${s.cohort.code}) has ${seats.length} allocated seat(s). Next: ${seats[0].exam.module.code} on ${fmtDate(seats[0].exam.date)} at ${minToTime(seats[0].exam.startMin)} — seat ${seats[0].label} in ${seats[0].room.code} (${seats[0].room.name}).`,
    rows: { columns: ["Exam", "Date", "Time", "Venue", "Seat"], data: seats.map((x) => [x.exam.module.code, fmtDate(x.exam.date), timeRange(x.exam.startMin, x.exam.endMin), x.room.code, x.label]) },
    links: [{ label: "Open profile", href: `/students/${s.id}` }, ...seats.slice(0, 1).map((x) => ({ label: `Seating plan ${x.exam.module.code}`, href: `/exams/${x.examId}` }))],
  };
}

async function timetable(p: Params): Promise<NlqAnswer> {
  const tt = await getPublishedTimetable();
  if (!tt) return { intent: "timetable", answer: "No published timetable." };
  let sessions = await loadSessions(tt.id);
  const key = (p.entity ?? p.cohort ?? p.room ?? "").toUpperCase();
  let label = "all groups";
  let href = "/timetable?view=all";
  if (p.cohort || /^L[456]/.test(key)) {
    const c = await prisma.cohort.findFirst({ where: { code: { contains: key } } });
    if (!c) return { intent: "timetable", answer: `Unknown group “${key}”.` };
    sessions = sessions.filter((s) => s.cohortId === c.id);
    label = `group ${c.code}`;
    href = `/timetable?view=cohort&id=${c.id}`;
  } else if (p.room || /-\d/.test(key)) {
    const r = await prisma.room.findFirst({ where: { code: { contains: key } } });
    if (!r) return { intent: "timetable", answer: `Unknown room “${key}”.` };
    sessions = sessions.filter((s) => s.roomId === r.id);
    label = `room ${r.code}`;
    href = `/timetable?view=room&id=${r.id}`;
  } else if (p.entity) {
    const l = await prisma.lecturer.findFirst({ where: { OR: p.entity.split(/\s+/).filter((w) => !/^dr\.?$/i.test(w)).map((w) => ({ name: { contains: w } })) } });
    if (l) {
      sessions = sessions.filter((s) => s.lecturerId === l.id);
      label = l.name;
      href = `/timetable?view=lecturer&id=${l.id}`;
    } else if (p.module) {
      sessions = sessions.filter((s) => s.moduleCode === p.module);
      label = `module ${p.module}`;
    }
  }
  const d = dayIndex(p.day);
  if (d !== null) sessions = sessions.filter((s) => s.day === d);
  sessions.sort((a, b) => a.day - b.day || a.startMin - b.startMin);
  if (!sessions.length) return { intent: "timetable", answer: `Nothing scheduled for ${label}${d !== null ? ` on ${DAY_NAMES[d]}` : ""}.`, links: [{ label: "Open timetable", href }] };
  return {
    intent: "timetable",
    answer: `${sessions.length} session(s) for ${label}${d !== null ? ` on ${DAY_NAMES[d]}` : " this week"}. First: ${DAY_NAMES[sessions[0].day]} ${minToTime(sessions[0].startMin)} ${sessions[0].moduleCode} in ${sessions[0].roomCode}.`,
    rows: { columns: ["Day", "Time", "Module", "Type", "Group", "Room", "Lecturer"], data: sessions.slice(0, 40).map((s) => [DAY_NAMES[s.day], minToTime(s.startMin), s.moduleCode, s.sessionType, s.cohortCode, s.roomCode, s.lecturerName]) },
    links: [{ label: "Open in timetable", href }],
  };
}

async function roomAvailability(p: Params): Promise<NlqAnswer> {
  const tt = await getPublishedTimetable();
  const sessions = tt ? await loadSessions(tt.id) : [];
  const d = dayIndex(p.day);
  const h = p.hour ? Number(p.hour) : null;
  const cap = p.capacity ? Number(p.capacity) : 0;
  if (d === null || h === null) return { intent: "room_availability", answer: "Tell me the day and hour, e.g. “free rooms on Tuesday at 10 for 40 students”." };
  const rooms = await prisma.room.findMany({ where: { active: true, capacity: { gte: cap } }, orderBy: { capacity: "asc" } });
  const busy = new Set(sessions.filter((s) => s.day === d && s.startMin === h * 60).map((s) => s.roomId));
  if (p.room) {
    const r = rooms.find((x) => x.code === p.room) ?? (await prisma.room.findFirst({ where: { code: p.room } }));
    if (!r) return { intent: "room_availability", answer: `Unknown room ${p.room}.` };
    const s = sessions.find((x) => x.roomId === r.id && x.day === d && x.startMin === h * 60);
    return { intent: "room_availability", answer: s ? `${r.code} is booked on ${DAY_NAMES[d]} at ${minToTime(h * 60)}: ${s.moduleCode} ${s.sessionType.toLowerCase()} for ${s.cohortCode} (${s.lecturerName}).` : `${r.code} is free on ${DAY_NAMES[d]} at ${minToTime(h * 60)} (capacity ${r.capacity}).`, links: [{ label: `Room ${r.code}`, href: `/rooms/${r.id}` }] };
  }
  const free = rooms.filter((r) => !busy.has(r.id));
  return {
    intent: "room_availability",
    answer: `${free.length} room(s) free on ${DAY_NAMES[d]} at ${minToTime(h * 60)}${cap ? ` with ≥${cap} seats` : ""}: ${free.slice(0, 8).map((r) => `${r.code} (${r.capacity})`).join(", ")}${free.length > 8 ? "…" : ""}.`,
    rows: { columns: ["Room", "Type", "Capacity", "Building"], data: free.map((r) => [r.code, r.type, r.capacity, r.building]) },
    links: [{ label: "Availability finder", href: `/rooms?day=${d}&hour=${h}&min=${cap}` }],
  };
}

async function workload(p: Params): Promise<NlqAnswer> {
  const tt = await getPublishedTimetable();
  const sessions = tt ? await loadSessions(tt.id) : [];
  const lecturers = await prisma.lecturer.findMany({ orderBy: { name: "asc" } });
  const rows = lecturers.map((l) => ({ l, hours: sessions.filter((s) => s.lecturerId === l.id).length })).sort((a, b) => b.hours / b.l.maxHoursPerWeek - a.hours / a.l.maxHoursPerWeek);
  if (p.lecturer) {
    const words = p.lecturer.split(/\s+/).filter((w) => !/^dr\.?$/i.test(w));
    const hit = rows.find((r) => words.every((w) => r.l.name.toLowerCase().includes(w.toLowerCase())));
    if (hit) {
      const mods = [...new Set(sessions.filter((s) => s.lecturerId === hit.l.id).map((s) => s.moduleCode))];
      return { intent: "workload", answer: `${hit.l.name} teaches ${hit.hours} contact hours/week against a limit of ${hit.l.maxHoursPerWeek} (${Math.round((hit.hours / hit.l.maxHoursPerWeek) * 100)}%), across ${mods.length} module(s): ${mods.join(", ")}.`, links: [{ label: "Open workload", href: `/faculty/${hit.l.id}` }] };
    }
  }
  const over = rows.filter((r) => r.hours > r.l.maxHoursPerWeek);
  return {
    intent: "workload",
    answer: over.length ? `${over.length} lecturer(s) exceed their weekly limit: ${over.map((r) => `${r.l.name} (${r.hours}/${r.l.maxHoursPerWeek}h)`).join(", ")}.` : `No lecturer is over their weekly limit. Highest load: ${rows[0].l.name} at ${rows[0].hours}/${rows[0].l.maxHoursPerWeek}h.`,
    rows: { columns: ["Lecturer", "Dept", "Hours", "Limit", "Load"], data: rows.slice(0, 12).map((r) => [r.l.name, r.l.department, r.hours, r.l.maxHoursPerWeek, `${Math.round((r.hours / r.l.maxHoursPerWeek) * 100)}%`]) },
    links: [{ label: "Faculty workload", href: "/faculty" }],
  };
}

async function moduleResults(p: Params): Promise<NlqAnswer> {
  if (!p.module) return { intent: "module_results", answer: "Which module? Use the code, e.g. CS4005." };
  const sheets = await prisma.resultSheet.findMany({ where: { module: { code: p.module } }, include: { cohort: true, module: true }, orderBy: { term: "desc" } });
  if (!sheets.length) return { intent: "module_results", answer: `No result sheets for ${p.module}.` };
  const data: (string | number)[][] = [];
  let text = "";
  for (const sh of sheets.slice(0, 6)) {
    const d = await loadSheet(sh.id);
    if (!d) continue;
    data.push([sh.term, sh.cohort.code, sh.status, d.stats.complete, d.stats.mean, `${d.stats.passRate}%`, d.results.filter((r) => r.result.passed === false).length, d.anomalies.length]);
    if (!text) text = `${sh.module.code} ${sh.module.name}: latest sheet (${sh.term}, ${sh.cohort.code}, ${sh.status}) has mean ${d.stats.mean}, pass rate ${d.stats.passRate}% and ${d.results.filter((r) => r.result.passed === false).length} fail(s)${d.anomalies.length ? `; ${d.anomalies.length} anomaly flag(s) raised` : ""}.`;
  }
  return { intent: "module_results", answer: text, rows: { columns: ["Term", "Group", "Status", "Complete", "Mean", "Pass rate", "Fails", "Anomalies"], data }, links: sheets.slice(0, 3).map((s) => ({ label: `${s.term} ${s.cohort.code}`, href: `/results/${s.id}` })) };
}

async function clashes(): Promise<NlqAnswer> {
  const tts = await prisma.timetable.findMany({ where: { term: TERMS.current, status: { in: ["PUBLISHED", "DRAFT"] } } });
  const limits = await lecturerLimits();
  const data: (string | number)[][] = [];
  let total = 0;
  for (const t of tts) {
    const cs = detectClashes(await loadSessions(t.id), limits);
    total += cs.length;
    for (const c of cs.slice(0, 10)) data.push([t.name, clashLabel(c.type), c.severity, c.message]);
  }
  return { intent: "clashes", answer: total ? `${total} conflict(s) across ${tts.length} timetable version(s). The published timetable ${data.some((r) => r[0] === tts.find((t) => t.status === "PUBLISHED")?.name) ? "has issues" : "is clash-free"}; drafts still contain conflicts to resolve.` : "No conflicts in any current timetable.", rows: data.length ? { columns: ["Timetable", "Type", "Severity", "Detail"], data } : undefined, links: [{ label: "Conflict monitor", href: "/timetable" }] };
}

async function atRisk(p: Params): Promise<NlqAnswer> {
  let list = await atRiskStudents(50);
  if (p.cohort) list = list.filter((r) => r.student.cohort.code === p.cohort);
  return {
    intent: "at_risk",
    answer: `${list.length} student(s)${p.cohort ? ` in ${p.cohort}` : ""} flagged for support. Highest risk: ${list.slice(0, 3).map((r) => `${r.student.firstName} ${r.student.lastName} (${r.score})`).join(", ")}.`,
    rows: { columns: ["Student", "No.", "Group", "Risk", "Drivers"], data: list.slice(0, 20).map((r) => [`${r.student.firstName} ${r.student.lastName}`, r.student.studentNo, r.student.cohort.code, r.score, r.drivers.join(", ")]) },
    links: [{ label: "Student directory", href: "/students?standing=AT_RISK" }],
  };
}

async function examInfo(p: Params): Promise<NlqAnswer> {
  const exams = await prisma.examSession.findMany({ where: { module: { code: p.module } }, include: { module: true, venues: { include: { room: true } }, cohorts: { include: { cohort: true } }, _count: { select: { seats: true, invigilations: true } } }, orderBy: { date: "asc" } });
  if (!exams.length) return { intent: "exam_info", answer: `No exam scheduled for ${p.module}.` };
  const e = exams[0];
  return {
    intent: "exam_info",
    answer: `${e.module.code} ${e.module.name}: ${fmtDate(e.date)} ${timeRange(e.startMin, e.endMin)} for ${e.cohorts.map((c) => c.cohort.code).join(", ")}. Venues: ${e.venues.map((v) => v.room.code).join(", ") || "not allocated"}. ${e._count.seats} seated, ${e._count.invigilations} invigilators — status ${e.status}.`,
    links: exams.map((x) => ({ label: `${x.module.code} · ${x.date}`, href: `/exams/${x.id}` })),
  };
}

async function roomUtilisation(): Promise<NlqAnswer> {
  const tt = await getPublishedTimetable();
  const sessions = tt ? await loadSessions(tt.id) : [];
  const total = await prisma.timeSlot.count();
  const rooms = await prisma.room.findMany({ where: { active: true } });
  const rows = rooms.map((r) => ({ r, used: sessions.filter((s) => s.roomId === r.id).length })).sort((a, b) => a.used - b.used);
  return {
    intent: "room_utilisation",
    answer: `Least used: ${rows.slice(0, 3).map((x) => `${x.r.code} (${Math.round((x.used / total) * 100)}%)`).join(", ")}. Most used: ${rows.slice(-3).reverse().map((x) => `${x.r.code} (${Math.round((x.used / total) * 100)}%)`).join(", ")}.`,
    rows: { columns: ["Room", "Type", "Capacity", "Hours/week", "Utilisation"], data: rows.map((x) => [x.r.code, x.r.type, x.r.capacity, x.used, `${Math.round((x.used / total) * 100)}%`]) },
    links: [{ label: "Rooms", href: "/rooms" }],
  };
}

async function studentProfile(p: Params): Promise<NlqAnswer> {
  const s = await findStudent(p.student);
  if (!s) return { intent: "student_profile", answer: `No student matching “${p.student}”.` };
  const progs = await prisma.progressionRecord.findMany({ where: { studentId: s.id }, orderBy: { term: "asc" } });
  const resits = await prisma.resit.count({ where: { enrollment: { studentId: s.id } } });
  const last = progs[progs.length - 1];
  return {
    intent: "student_profile",
    answer: `${s.firstName} ${s.lastName} (${s.studentNo}) — ${s.intake.programme.name}, ${s.cohort.code}, semester ${s.semester}, standing ${s.standing}. ${last ? `Last progression: ${last.decision.replace(/_/g, " ")} with average ${last.average} (${last.term}).` : "No progression decision yet."} ${resits} resit(s) on record.`,
    rows: progs.length ? { columns: ["Term", "Average", "Decision", "Note"], data: progs.map((x) => [x.term, x.average, x.decision, x.note ?? ""]) } : undefined,
    links: [{ label: "Open profile", href: `/students/${s.id}` }],
  };
}
