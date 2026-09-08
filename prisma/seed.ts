/* eslint-disable no-console */
// Deterministic demo dataset for RTE Hub (Islington College).
// Run: npm run db:seed
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";
import { rng, TERMS } from "../src/lib/constants";
import { generateTimetable, type Demand } from "../src/lib/engine/scheduler";
import { generateSeating, suggestVenues } from "../src/lib/engine/seating";
import { allocateInvigilators } from "../src/lib/engine/invigilation";
import { computeResult, progressionDecision, riskScore } from "../src/lib/engine/grading";

const prisma = new PrismaClient();
const rand = rng(20260912);
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const gauss = (mean: number, sd: number) => {
  const u = 1 - rand();
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

const DEMO_PASSWORD = "Password123";
function hash(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

const FIRST = ["Aarav", "Sita", "Bibek", "Prakriti", "Nischal", "Sujata", "Rohan", "Anisha", "Kiran", "Pooja", "Sandesh", "Manisha", "Sagar", "Riya", "Bikash", "Sneha", "Ujjwal", "Kritika", "Dipesh", "Alisha", "Prajwal", "Sabina", "Nabin", "Shristi", "Amit", "Nisha", "Suman", "Pratiksha", "Rajesh", "Bina", "Yuvraj", "Ishani", "Salokya", "Ayush", "Barsha", "Milan", "Asmita", "Rupak", "Nikita", "Saroj"];
const LAST = ["Shrestha", "Gurung", "Tamang", "Karki", "Rai", "Maharjan", "Adhikari", "Thapa", "Poudel", "Ghimire", "Lama", "Basnet", "Khadka", "Magar", "Bhandari", "Sharma", "Joshi", "Regmi", "Dahal", "Pandey", "Limbu", "Koirala", "Bista", "Acharya"];

const PROGRAMMES = [
  { id: "prog-comp", code: "BSC-COMP", name: "BSc (Hons) Computing", level: "UG", dept: "Computing" },
  { id: "prog-cns", code: "BSC-CNS", name: "BSc (Hons) Computer Networking & IT Security", level: "UG", dept: "Networking" },
  { id: "prog-mmt", code: "BSC-MMT", name: "BSc (Hons) Multimedia Technologies", level: "UG", dept: "Multimedia" },
  { id: "prog-bus", code: "BA-BUS", name: "BA (Hons) Business Administration", level: "UG", dept: "Business" },
];

// modules: [code, name, level, semester, lab]
type ModDef = [string, string, number, number, boolean];
const MODULES: Record<string, ModDef[]> = {
  "prog-comp": [
    ["CS4001", "Programming", 4, 1, true], ["CS4002", "Computer Systems", 4, 1, false], ["CS4003", "Web Design & Development", 4, 1, true],
    ["CS4004", "Mathematics for Computing", 4, 2, false], ["CS4005", "Information Systems", 4, 2, false], ["CS4006", "Digital Media", 4, 2, true],
    ["CS5001", "Database Systems", 5, 1, true], ["CS5002", "Software Engineering", 5, 1, false], ["CS5003", "Object Oriented Programming", 5, 1, true],
    ["CS5004", "Computer Networks", 5, 2, false], ["CS5005", "Human Computer Interaction", 5, 2, false], ["CS5006", "Data Structures & Algorithms", 5, 2, true],
    ["CS6001", "Final Year Project", 6, 1, false], ["CS6002", "Artificial Intelligence & Machine Learning", 6, 1, true], ["CS6003", "Cloud Computing", 6, 1, true],
    ["CS6004", "Application Development", 6, 2, true], ["CS6005", "Professional Issues in Computing", 6, 2, false], ["CS6006", "Advanced Databases", 6, 2, true],
  ],
  "prog-cns": [
    ["CN4001", "Networking Fundamentals", 4, 1, true], ["CN4002", "Computer Hardware", 4, 1, false], ["CN4003", "Programming for Networks", 4, 1, true],
    ["CN4004", "Operating Systems", 4, 2, true], ["CN4005", "Security Essentials", 4, 2, false], ["CN4006", "Mathematics for Networking", 4, 2, false],
    ["CN5001", "Routing & Switching", 5, 1, true], ["CN5002", "Network Security", 5, 1, false], ["CN5003", "Server Administration", 5, 1, true],
    ["CN5004", "Wireless Networks", 5, 2, false], ["CN5005", "Ethical Hacking", 5, 2, true], ["CN5006", "Cryptography", 5, 2, false],
    ["CN6001", "Final Year Project", 6, 1, false], ["CN6002", "Digital Forensics", 6, 1, true], ["CN6003", "Cloud & Virtualisation", 6, 1, true],
    ["CN6004", "Penetration Testing", 6, 2, true], ["CN6005", "Network Management", 6, 2, false], ["CN6006", "IoT Security", 6, 2, false],
  ],
  "prog-mmt": [
    ["MM4001", "Design Principles", 4, 1, false], ["MM4002", "Digital Imaging", 4, 1, true], ["MM4003", "Web Technologies", 4, 1, true],
    ["MM4004", "Animation Basics", 4, 2, true], ["MM4005", "Audio & Video Production", 4, 2, true], ["MM4006", "Media Culture", 4, 2, false],
    ["MM5001", "3D Modelling", 5, 1, true], ["MM5002", "Interactive Media", 5, 1, true], ["MM5003", "Motion Graphics", 5, 1, false],
    ["MM5004", "Game Design", 5, 2, true], ["MM5005", "User Experience Design", 5, 2, false], ["MM5006", "Visual Effects", 5, 2, true],
  ],
  "prog-bus": [
    ["BA4001", "Principles of Management", 4, 1, false], ["BA4002", "Business Economics", 4, 1, false], ["BA4003", "Accounting for Business", 4, 1, false],
    ["BA4004", "Marketing Fundamentals", 4, 2, false], ["BA4005", "Business Law", 4, 2, false], ["BA4006", "Quantitative Methods", 4, 2, false],
    ["BA5001", "Organisational Behaviour", 5, 1, false], ["BA5002", "Financial Management", 5, 1, false], ["BA5003", "Operations Management", 5, 1, false],
    ["BA5004", "Human Resource Management", 5, 2, false], ["BA5005", "International Business", 5, 2, false], ["BA5006", "Business Research Methods", 5, 2, false],
    ["BA6001", "Strategic Management", 6, 1, false], ["BA6002", "Entrepreneurship", 6, 1, false], ["BA6003", "Dissertation", 6, 1, false],
    ["BA6004", "Corporate Governance", 6, 2, false], ["BA6005", "Digital Business", 6, 2, false], ["BA6006", "Leadership", 6, 2, false],
  ],
};

// cohorts per programme: [levelNow, groups, sizeRange]
const COHORT_PLAN: Record<string, { level: number; groups: number; size: [number, number] }[]> = {
  "prog-comp": [{ level: 4, groups: 3, size: [30, 36] }, { level: 5, groups: 2, size: [28, 34] }, { level: 6, groups: 2, size: [26, 32] }],
  "prog-cns": [{ level: 4, groups: 1, size: [28, 34] }, { level: 5, groups: 1, size: [24, 30] }, { level: 6, groups: 1, size: [22, 28] }],
  "prog-mmt": [{ level: 4, groups: 1, size: [22, 28] }, { level: 5, groups: 1, size: [20, 26] }],
  "prog-bus": [{ level: 4, groups: 2, size: [34, 42] }, { level: 5, groups: 1, size: [32, 40] }, { level: 6, groups: 1, size: [30, 36] }],
};

const ROOMS = [
  { code: "LB-101", name: "Lecture Room 101", building: "London Block", capacity: 60, type: "LECTURE", rows: 6, cols: 10, equipment: ["Projector", "Whiteboard", "Audio"] },
  { code: "LB-102", name: "Lecture Room 102", building: "London Block", capacity: 50, type: "LECTURE", rows: 5, cols: 10, equipment: ["Projector", "Whiteboard"] },
  { code: "LB-103", name: "Lecture Room 103", building: "London Block", capacity: 45, type: "LECTURE", rows: 5, cols: 9, equipment: ["Projector", "Whiteboard"] },
  { code: "LB-104", name: "Lecture Room 104", building: "London Block", capacity: 40, type: "LECTURE", rows: 5, cols: 8, equipment: ["Projector", "Whiteboard"] },
  { code: "LB-105", name: "Lecture Room 105", building: "London Block", capacity: 40, type: "LECTURE", rows: 5, cols: 8, equipment: ["Smart Board"] },
  { code: "LB-106", name: "Lecture Room 106", building: "London Block", capacity: 36, type: "LECTURE", rows: 6, cols: 6, equipment: ["Projector"] },
  { code: "LB-201", name: "Computer Lab 201", building: "London Block", capacity: 36, type: "LAB", rows: 6, cols: 6, equipment: ["36 PCs", "Projector", "Cisco Rack"] },
  { code: "LB-202", name: "Computer Lab 202", building: "London Block", capacity: 36, type: "LAB", rows: 6, cols: 6, equipment: ["36 PCs", "Projector"] },
  { code: "LB-203", name: "Computer Lab 203", building: "London Block", capacity: 30, type: "LAB", rows: 5, cols: 6, equipment: ["30 PCs", "Projector"] },
  { code: "LB-204", name: "Multimedia Lab 204", building: "London Block", capacity: 28, type: "LAB", rows: 4, cols: 7, equipment: ["28 iMacs", "Wacom Tablets", "Projector"] },
  { code: "LB-205", name: "Networking Lab 205", building: "London Block", capacity: 32, type: "LAB", rows: 4, cols: 8, equipment: ["32 PCs", "Cisco Rack", "Server Rack"] },
  { code: "MB-301", name: "Seminar Room 301", building: "Main Block", capacity: 25, type: "SEMINAR", rows: 5, cols: 5, equipment: ["TV Screen", "Whiteboard"] },
  { code: "MB-302", name: "Seminar Room 302", building: "Main Block", capacity: 25, type: "SEMINAR", rows: 5, cols: 5, equipment: ["TV Screen"] },
  { code: "MB-303", name: "Seminar Room 303", building: "Main Block", capacity: 20, type: "SEMINAR", rows: 4, cols: 5, equipment: ["Whiteboard"] },
  { code: "MB-401", name: "Lecture Theatre 401", building: "Main Block", capacity: 80, type: "LECTURE", rows: 8, cols: 10, equipment: ["Projector", "Audio", "Lectern PC"] },
  { code: "KH-01", name: "Kumari Hall", building: "Kumari Hall", capacity: 240, type: "HALL", rows: 12, cols: 20, equipment: ["Stage", "PA System", "Projector"] },
  { code: "AUD-01", name: "Auditorium", building: "Main Block", capacity: 120, type: "HALL", rows: 10, cols: 12, equipment: ["PA System", "Projector"] },
];

const LECTURERS = [
  ["Dr. Ramesh Shrestha", "Computing"], ["Sunita Maharjan", "Computing"], ["Bishal Karki", "Computing"], ["Anjali Gurung", "Computing"],
  ["Prabin Tamang", "Computing"], ["Dr. Kabita Rai", "Computing"], ["Niraj Adhikari", "Computing"], ["Rashmi Thapa", "Computing"],
  ["Dr. Suresh Poudel", "Networking"], ["Kamal Lama", "Networking"], ["Sarita Basnet", "Networking"], ["Binod Khadka", "Networking"],
  ["Pramila Magar", "Multimedia"], ["Ashish Bhandari", "Multimedia"], ["Rekha Sharma", "Multimedia"],
  ["Dr. Deepak Joshi", "Business"], ["Manju Regmi", "Business"], ["Santosh Dahal", "Business"], ["Kalpana Pandey", "Business"], ["Roshan Limbu", "Business"],
  ["Ganesh Koirala", "Computing"], ["Sabitri Bista", "Networking"],
];

async function main() {
  console.log("Resetting database…");
  // order matters for FK constraints
  await prisma.invigilation.deleteMany();
  await prisma.seatAllocation.deleteMany();
  await prisma.examVenue.deleteMany();
  await prisma.examCohort.deleteMany();
  await prisma.examSession.deleteMany();
  await prisma.timetableSession.deleteMany();
  await prisma.timetable.deleteMany();
  await prisma.teachingAssignment.deleteMany();
  await prisma.timeSlot.deleteMany();
  await prisma.mark.deleteMany();
  await prisma.resultSheet.deleteMany();
  await prisma.resit.deleteMany();
  await prisma.progressionRecord.deleteMany();
  await prisma.moduleEnrollment.deleteMany();
  await prisma.assessment.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.student.deleteMany();
  await prisma.cohort.deleteMany();
  await prisma.intake.deleteMany();
  await prisma.module.deleteMany();
  await prisma.programme.deleteMany();
  await prisma.lecturer.deleteMany();
  await prisma.room.deleteMany();

  // ── programmes & modules ──
  await prisma.programme.createMany({ data: PROGRAMMES.map(({ id, code, name, level }) => ({ id, code, name, level })) });
  const moduleRows: { id: string; code: string; name: string; level: number; semester: number; programmeId: string; requiresLab: boolean; credits: number }[] = [];
  for (const [pid, defs] of Object.entries(MODULES)) {
    for (const [code, name, level, semester, lab] of defs) {
      moduleRows.push({ id: `mod-${code}`, code, name, level, semester, programmeId: pid, requiresLab: lab, credits: name.includes("Project") || name.includes("Dissertation") ? 40 : 20 });
    }
  }
  await prisma.module.createMany({ data: moduleRows });
  const assessments = moduleRows.flatMap((m) => {
    const cw = m.requiresLab ? 60 : 50;
    return [
      { id: `as-${m.code}-CW`, moduleId: m.id, name: "Coursework", weight: cw, maxMarks: 100 },
      { id: `as-${m.code}-EX`, moduleId: m.id, name: "Examination", weight: 100 - cw, maxMarks: 100 },
    ];
  });
  await prisma.assessment.createMany({ data: assessments });

  // ── rooms, lecturers, slots ──
  await prisma.room.createMany({ data: ROOMS.map((r, i) => ({ id: `room-${i + 1}`, ...r, equipment: JSON.stringify(r.equipment) })) });
  await prisma.lecturer.createMany({
    data: LECTURERS.map(([name, department], i) => ({
      id: `lec-${i + 1}`,
      staffNo: `STF${String(1001 + i)}`,
      name,
      email: `${name.toLowerCase().replace(/dr\. /, "").replace(/[^a-z ]/g, "").trim().replace(/ /g, ".")}@islington.edu.np`,
      department,
      maxHoursPerWeek: 16 + Math.floor(rand() * 5),
    })),
  });
  const slotRows: { id: string; day: number; startMin: number; endMin: number; label: string }[] = [];
  for (const day of [0, 1, 2, 3, 4, 5]) {
    for (let h = 7; h < 17; h++) {
      slotRows.push({ id: `slot-${day}-${h}`, day, startMin: h * 60, endMin: (h + 1) * 60, label: `${String(h).padStart(2, "0")}:00` });
    }
  }
  await prisma.timeSlot.createMany({ data: slotRows });

  // ── intakes, cohorts, students ──
  type CohortRec = { id: string; code: string; programmeId: string; level: number; size: number; intakeId: string; students: { id: string; studentNo: string; name: string; ability: number }[] };
  const cohorts: CohortRec[] = [];
  const intakeRows: { id: string; code: string; year: number; term: string; programmeId: string }[] = [];
  const studentRows: { id: string; studentNo: string; firstName: string; lastName: string; email: string; intakeId: string; cohortId: string; semester: number }[] = [];
  let stuCounter = 0;
  const usedEmails = new Set<string>();
  for (const p of PROGRAMMES) {
    const plan = COHORT_PLAN[p.id];
    for (const c of plan) {
      const intakeYear = 2026 - (c.level - 4);
      const intakeId = `intake-${p.code}-${intakeYear}`;
      if (!intakeRows.find((i) => i.id === intakeId)) intakeRows.push({ id: intakeId, code: `${intakeYear}-SEP-${p.code}`, year: intakeYear, term: "SEP", programmeId: p.id });
      for (let g = 1; g <= c.groups; g++) {
        const prefix = p.code.split("-")[1].slice(0, 2);
        const code = `L${c.level}${prefix}G${g}`;
        const size = c.size[0] + Math.floor(rand() * (c.size[1] - c.size[0] + 1));
        const rec: CohortRec = { id: `coh-${code}`, code, programmeId: p.id, level: c.level, size, intakeId, students: [] };
        for (let i = 0; i < size; i++) {
          stuCounter++;
          const fn = pick(FIRST);
          const ln = pick(LAST);
          const studentNo = `${intakeYear}${String(stuCounter).padStart(4, "0")}`;
          let email = `${fn}.${ln}${stuCounter}@islingtoncollege.edu.np`.toLowerCase();
          while (usedEmails.has(email)) email = `x${email}`;
          usedEmails.add(email);
          const ability = clamp(gauss(58, 12), 25, 92);
          rec.students.push({ id: `stu-${studentNo}`, studentNo, name: `${fn} ${ln}`, ability });
          studentRows.push({ id: `stu-${studentNo}`, studentNo, firstName: fn, lastName: ln, email, intakeId, cohortId: rec.id, semester: (c.level - 4) * 2 + 1 });
        }
        cohorts.push(rec);
      }
    }
  }
  await prisma.intake.createMany({ data: intakeRows });
  await prisma.cohort.createMany({ data: cohorts.map((c) => ({ id: c.id, code: c.code, name: `Level ${c.level} Group ${c.code.slice(-1)} — ${PROGRAMMES.find((p) => p.id === c.programmeId)!.code}`, intakeId: c.intakeId, semester: (c.level - 4) * 2 + 1, size: c.size })) });
  await prisma.student.createMany({ data: studentRows });
  console.log(`Cohorts: ${cohorts.length}, students: ${studentRows.length}`);

  // ── enrolments, sheets, marks (historical + processing + current) ──
  // term plan per cohort level: which (level, semester) was studied in which term
  const termFor = (levelNow: number, level: number, semester: number): string | null => {
    const yearsBack = levelNow - level;
    if (yearsBack < 0) return null;
    if (semester === 1) return yearsBack === 0 ? TERMS.current : yearsBack === 1 ? TERMS.previous : "2024-AUT";
    return yearsBack === 0 ? null : yearsBack === 1 ? TERMS.processing : "2025-SPR";
  };
  // Demo-critical sheets get fixed statuses so every showcase (anomalies, validation, resit exam) is reachable.
  const FORCED_STATUS: Record<string, string> = {
    "sheet-L5COG1-CS4004": "PUBLISHED", // resit exam source (fails feed the Sept resit sitting)
    "sheet-L5COG2-CS4004": "PUBLISHED",
    "sheet-L5CNG1-CN4005": "PUBLISHED", // second paper in the resit sitting
    "sheet-L5COG1-CS4005": "SUBMITTED", // mean-shift / high fail rate anomaly awaiting approval
    "sheet-L5COG2-CS4005": "SUBMITTED", // identical-marks cluster anomaly
    "sheet-L5COG1-CS4006": "DRAFT", // out-of-range + missing marks validation demo
    "sheet-L6COG1-CS5005": "SUBMITTED", // personal outlier anomaly
  };
  const statusForTerm = (term: string, idx: number, sheetId?: string): string => {
    if (sheetId && FORCED_STATUS[sheetId]) return FORCED_STATUS[sheetId];
    if (term === TERMS.current) return "DRAFT";
    if (term === TERMS.processing) return ["PUBLISHED", "APPROVED", "SUBMITTED", "DRAFT", "SUBMITTED", "APPROVED"][idx % 6];
    return "PUBLISHED";
  };

  const enrolRows: { id: string; studentId: string; moduleId: string; term: string; attempt: number; status: string }[] = [];
  const sheetRows: { id: string; moduleId: string; cohortId: string; term: string; status: string; submittedBy?: string; submittedAt?: Date; approvedBy?: string; approvedAt?: Date; publishedAt?: Date }[] = [];
  const markRows: { id: string; sheetId: string; enrollmentId: string; assessmentId: string; marks: number | null }[] = [];
  const resitRows: { id: string; enrollmentId: string; reason: string; term: string; outcome: string }[] = [];
  const progressionRows: { id: string; studentId: string; term: string; decision: string; average: number; credits: number; note: string }[] = [];
  const studentTermResults = new Map<string, { moduleCode: string; credits: number; overall: number | null; passed: boolean | null; term: string }[]>();
  const moduleHistory = new Map<string, number[]>();
  let sheetIdx = 0;
  let markId = 0;
  let enrolId = 0;

  const lecturerIds = LECTURERS.map((_, i) => `lec-${i + 1}`);
  const lecturersByDept = (dept: string) => LECTURERS.map((l, i) => ({ id: `lec-${i + 1}`, dept: l[1] })).filter((l) => l.dept === dept).map((l) => l.id);
  const moduleLecturer = new Map<string, string>();
  for (const m of moduleRows) {
    const dept = PROGRAMMES.find((p) => p.id === m.programmeId)!.dept;
    moduleLecturer.set(m.id, pick(lecturersByDept(dept)));
  }

  for (const c of cohorts) {
    const mods = moduleRows.filter((m) => m.programmeId === c.programmeId);
    for (const m of mods) {
      const term = termFor(c.level, m.level, m.semester);
      if (!term) continue;
      sheetIdx++;
      const sheetId = `sheet-${c.code}-${m.code}`;
      const status = statusForTerm(term, sheetIdx, sheetId);
      const now = new Date();
      sheetRows.push({
        id: sheetId, moduleId: m.id, cohortId: c.id, term, status,
        submittedBy: status !== "DRAFT" ? moduleLecturer.get(m.id) : undefined,
        submittedAt: status !== "DRAFT" ? new Date(now.getTime() - 20 * 864e5) : undefined,
        approvedBy: status === "APPROVED" || status === "PUBLISHED" ? "user-rte" : undefined,
        approvedAt: status === "APPROVED" || status === "PUBLISHED" ? new Date(now.getTime() - 12 * 864e5) : undefined,
        publishedAt: status === "PUBLISHED" ? new Date(now.getTime() - 7 * 864e5) : undefined,
      });
      const cwId = `as-${m.code}-CW`;
      const exId = `as-${m.code}-EX`;
      const cwW = m.requiresLab ? 60 : 40;
      // module difficulty offset; inject a "mean shift" anomaly on one processing sheet
      const difficulty = gauss(0, 5) + (sheetId === "sheet-L5COG1-CS4005" ? -18 : 0);
      const cluster = sheetId === "sheet-L5COG2-CS4005"; // identical marks cluster anomaly
      const missingProb = status === "DRAFT" && term === TERMS.processing ? 0.12 : 0;
      const isCurrent = term === TERMS.current;
      c.students.forEach((s, si) => {
        enrolId++;
        const eid = `enr-${enrolId}`;
        let cw: number | null = null;
        let ex: number | null = null;
        if (!isCurrent) {
          cw = Math.round(clamp(gauss(s.ability + difficulty + 3, 9), 0, 100));
          ex = Math.round(clamp(gauss(s.ability + difficulty - 3, 11), 0, 100));
          if (cluster && si % 4 === 0) cw = 62;
          if (missingProb && rand() < missingProb) ex = null;
          if (sheetId === "sheet-L5COG1-CS4006" && si === 3) ex = 105; // out-of-range demo
          if (sheetId === "sheet-L6COG1-CS5005" && si === 7) ex = Math.round(clamp(s.ability - 35, 0, 100)); // personal outlier demo
        }
        const marksMap: Record<string, number | null> = { [cwId]: cw, [exId]: ex };
        const res = computeResult(
          { enrollmentId: eid, studentId: s.id, studentNo: s.studentNo, name: s.name, attempt: 1, marks: marksMap },
          [{ id: cwId, name: "Coursework", weight: cwW, maxMarks: 100 }, { id: exId, name: "Examination", weight: 100 - cwW, maxMarks: 100 }],
        );
        const enrolStatus = isCurrent ? "ACTIVE" : status === "PUBLISHED" ? (res.passed ? "PASSED" : res.passed === false ? "FAILED" : "ACTIVE") : "ACTIVE";
        enrolRows.push({ id: eid, studentId: s.id, moduleId: m.id, term, attempt: 1, status: enrolStatus });
        markRows.push({ id: `mk-${++markId}`, sheetId, enrollmentId: eid, assessmentId: cwId, marks: cw });
        markRows.push({ id: `mk-${++markId}`, sheetId, enrollmentId: eid, assessmentId: exId, marks: ex });
        if (status === "PUBLISHED" && res.overall !== null) {
          const h = moduleHistory.get(m.id) ?? [];
          h.push(res.overall);
          moduleHistory.set(m.id, h);
          if (res.passed === false) {
            const resitTerm = term === TERMS.previous ? TERMS.processing : term === "2024-AUT" ? "2025-SPR" : term === "2025-SPR" ? TERMS.previous : TERMS.current;
            const outcome = resitTerm === TERMS.current ? "PENDING" : rand() < 0.7 ? "PASSED" : "FAILED";
            resitRows.push({ id: `resit-${eid}`, enrollmentId: eid, reason: res.componentFail && (res.overall ?? 0) >= 40 ? "Component below threshold" : "Overall mark below 40", term: resitTerm, outcome });
          }
        }
        if (!isCurrent) {
          // progression decisions are only made once EVERY sheet of the term is published
          const list = studentTermResults.get(s.id) ?? [];
          list.push({ moduleCode: m.code, credits: m.credits, overall: status === "PUBLISHED" ? res.overall : null, passed: status === "PUBLISHED" ? res.passed : null, term });
          studentTermResults.set(s.id, list);
        }
      });
    }
  }

  // progression records per published term + standing
  const standingUpdates: { id: string; standing: string }[] = [];
  for (const c of cohorts) {
    for (const s of c.students) {
      const all = studentTermResults.get(s.id) ?? [];
      const terms = [...new Set(all.map((r) => r.term))];
      let lastAvg: number | null = null;
      let prevAvg: number | null = null;
      let fails = 0;
      for (const t of terms.sort()) {
        const rs = all.filter((r) => r.term === t);
        if (rs.some((r) => r.overall === null)) continue; // term not fully published yet
        const d = progressionDecision(rs);
        progressionRows.push({ id: `prog-${s.id}-${t}`, studentId: s.id, term: t, decision: d.decision, average: d.average, credits: rs.reduce((a, r) => a + (r.passed ? r.credits : 0), 0), note: d.note });
        prevAvg = lastAvg;
        lastAvg = d.average;
        fails += rs.filter((r) => r.passed === false).length;
      }
      const resits = resitRows.filter((r) => r.enrollmentId.startsWith("enr-") && all.length && false).length; // placeholder (computed at query time)
      const score = riskScore({ average: lastAvg, fails, resits, trend: lastAvg !== null && prevAvg !== null ? lastAvg - prevAvg : null, incomplete: 0 });
      const standing = score >= 70 ? "PROBATION" : score >= 45 ? "AT_RISK" : "GOOD";
      if (standing !== "GOOD") standingUpdates.push({ id: s.id, standing });
    }
  }

  const chunk = async <T,>(rows: T[], fn: (batch: T[]) => Promise<unknown>, size = 500) => {
    for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
  };
  await chunk(enrolRows, (b) => prisma.moduleEnrollment.createMany({ data: b }));
  await prisma.resultSheet.createMany({ data: sheetRows });
  await chunk(markRows, (b) => prisma.mark.createMany({ data: b }));
  await prisma.resit.createMany({ data: resitRows });
  await chunk(progressionRows, (b) => prisma.progressionRecord.createMany({ data: b }));
  for (const u of standingUpdates) await prisma.student.update({ where: { id: u.id }, data: { standing: u.standing } });
  console.log(`Enrolments: ${enrolRows.length}, sheets: ${sheetRows.length}, marks: ${markRows.length}, resits: ${resitRows.length}`);

  // ── teaching assignments for the current term ──
  const assignmentRows: { id: string; moduleId: string; cohortId: string; lecturerId: string; sessionType: string; hoursPerWeek: number; term: string }[] = [];
  for (const c of cohorts) {
    const mods = moduleRows.filter((m) => m.programmeId === c.programmeId && m.level === c.level && m.semester === 1);
    for (const m of mods) {
      const lect = moduleLecturer.get(m.id)!;
      const tutor = pick(lecturersByDept(PROGRAMMES.find((p) => p.id === c.programmeId)!.dept));
      assignmentRows.push({ id: `ta-${c.code}-${m.code}-L`, moduleId: m.id, cohortId: c.id, lecturerId: lect, sessionType: "LECTURE", hoursPerWeek: 2, term: TERMS.current });
      assignmentRows.push({ id: `ta-${c.code}-${m.code}-T`, moduleId: m.id, cohortId: c.id, lecturerId: tutor, sessionType: "TUTORIAL", hoursPerWeek: 1, term: TERMS.current });
      if (m.requiresLab) assignmentRows.push({ id: `ta-${c.code}-${m.code}-P`, moduleId: m.id, cohortId: c.id, lecturerId: tutor, sessionType: "LAB", hoursPerWeek: 2, term: TERMS.current });
    }
  }
  await prisma.teachingAssignment.createMany({ data: assignmentRows });

  // ── generate the master timetable with the engine ──
  const lecturerById = new Map(await prisma.lecturer.findMany().then((ls) => ls.map((l) => [l.id, l] as const)));
  const demands: Demand[] = assignmentRows.map((a) => {
    const m = moduleRows.find((x) => x.id === a.moduleId)!;
    const c = cohorts.find((x) => x.id === a.cohortId)!;
    const l = lecturerById.get(a.lecturerId)!;
    return {
      assignmentId: a.id, moduleId: m.id, moduleCode: m.code, requiresLab: m.requiresLab,
      cohortId: c.id, cohortCode: c.code, cohortSize: c.size,
      lecturerId: l.id, lecturerName: l.name, lecturerMaxHours: l.maxHoursPerWeek,
      sessionType: a.sessionType, hoursPerWeek: a.hoursPerWeek,
    };
  });
  const roomsLite = ROOMS.map((r, i) => ({ id: `room-${i + 1}`, code: r.code, capacity: r.capacity, type: r.type }));
  const result = generateTimetable(demands, roomsLite, slotRows, { seed: 7 });
  console.log(`Timetable: placed ${result.stats.placed}/${result.stats.units}, unplaced ${result.unplaced.length}, clashes ${result.stats.clashes}, score ${result.score}`);
  for (const u of result.unplaced) console.log("  unplaced:", u.demand.moduleCode, u.demand.cohortCode, u.demand.sessionType, "-", u.reason);
  await prisma.timetable.create({ data: { id: "tt-master", name: "Autumn 2026 — Master Timetable", term: TERMS.current, status: "PUBLISHED", generated: true, score: result.score } });
  await chunk(
    result.sessions.map((s, i) => ({ id: `ts-${i + 1}`, timetableId: "tt-master", moduleId: s.moduleId, cohortId: s.cohortId, lecturerId: s.lecturerId, roomId: s.roomId, slotId: s.slotId, sessionType: s.sessionType })),
    (b) => prisma.timetableSession.createMany({ data: b }),
  );

  // A legacy "spreadsheet import" draft that contains deliberate conflicts (for the clash demo)
  await prisma.timetable.create({ data: { id: "tt-legacy", name: "Legacy spreadsheet import (Sep 2026)", term: TERMS.current, status: "DRAFT", generated: false } });
  const sample = result.sessions.slice(0, 40);
  const legacy = sample.map((s, i) => ({ id: `tl-${i + 1}`, timetableId: "tt-legacy", moduleId: s.moduleId, cohortId: s.cohortId, lecturerId: s.lecturerId, roomId: s.roomId, slotId: s.slotId, sessionType: s.sessionType }));
  // conflicts: room double booking, lecturer clash, cohort overlap, capacity overflow
  legacy[5] = { ...legacy[5], roomId: legacy[4].roomId, slotId: legacy[4].slotId };
  legacy[9] = { ...legacy[9], lecturerId: legacy[8].lecturerId, slotId: legacy[8].slotId };
  legacy[13] = { ...legacy[13], cohortId: legacy[12].cohortId, slotId: legacy[12].slotId };
  legacy[17] = { ...legacy[17], roomId: "room-14" }; // MB-303 capacity 20
  await prisma.timetableSession.createMany({ data: legacy });

  // ── examinations ──
  const examRows: { id: string; moduleId: string; term: string; date: string; startMin: number; endMin: number; status: string }[] = [];
  const examCohortRows: { id: string; examId: string; cohortId: string }[] = [];
  // December main exam period: one exam per current-term module, cohorts of that programme+level sit together
  const currentModules = moduleRows.filter((m) => m.semester === 1 && cohorts.some((c) => c.programmeId === m.programmeId && c.level === m.level));
  const examDates = ["2026-12-06", "2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-13", "2026-12-14", "2026-12-15"];
  currentModules.forEach((m, i) => {
    if (m.name.includes("Project") || m.name.includes("Dissertation")) return;
    const id = `exam-${m.code}`;
    const date = examDates[i % examDates.length];
    const startMin = i % 2 === 0 ? 9 * 60 : 13 * 60;
    examRows.push({ id, moduleId: m.id, term: TERMS.current, date, startMin, endMin: startMin + 120, status: "PLANNED" });
    for (const c of cohorts.filter((c) => c.programmeId === m.programmeId && c.level === m.level)) examCohortRows.push({ id: `ec-${id}-${c.code}`, examId: id, cohortId: c.id });
  });
  // September resit sitting for the processing term (two papers in one sitting -> mixed seating demo)
  const resitMods = ["mod-CS4004", "mod-CN4005"];
  for (const mid of resitMods) {
    const m = moduleRows.find((x) => x.id === mid)!;
    const id = `exam-resit-${m.code}`;
    examRows.push({ id, moduleId: mid, term: TERMS.processing, date: "2026-09-20", startMin: 10 * 60, endMin: 12 * 60, status: "PLANNED" });
    for (const c of cohorts.filter((c) => c.programmeId === m.programmeId && c.level === 5)) examCohortRows.push({ id: `ec-${id}-${c.code}`, examId: id, cohortId: c.id });
  }
  await prisma.examSession.createMany({ data: examRows });
  await prisma.examCohort.createMany({ data: examCohortRows });

  // Run venue suggestion + seating + invigilation for the first two December sittings and the resit sitting
  const venuesLite = ROOMS.map((r, i) => ({ roomId: `room-${i + 1}`, code: r.code, rows: r.rows, cols: r.cols, capacity: r.capacity }))
    .filter((v) => ["HALL", "LECTURE"].includes(ROOMS.find((r) => r.code === v.code)!.type));
  const sittings = new Map<string, typeof examRows>();
  for (const e of examRows) {
    const k = `${e.date}|${e.startMin}`;
    sittings.set(k, [...(sittings.get(k) ?? []), e]);
  }
  const dutyCount = new Map<string, number>(lecturerIds.map((id) => [id, 0]));
  let seatId = 0;
  let invId = 0;
  const sittingKeys = [...sittings.keys()].sort();
  const toSeat = [sittingKeys.find((k) => k.startsWith("2026-09-20"))!, ...sittingKeys.filter((k) => k.startsWith("2026-12-06"))];
  for (const key of toSeat) {
    const exams = sittings.get(key)!;
    const busyRooms = new Set<string>();
    const seatExams = exams.map((e) => {
      const cs = examCohortRows.filter((ec) => ec.examId === e.id).map((ec) => cohorts.find((c) => c.id === ec.cohortId)!);
      const m = moduleRows.find((x) => x.id === e.moduleId)!;
      let students = cs.flatMap((c) => c.students.map((s) => ({ id: s.id, studentNo: s.studentNo, name: s.name, cohortCode: c.code })));
      if (e.id.startsWith("exam-resit")) {
        // only students who failed / have a pending resit for that module
        // only students who failed the module (matches examCandidates() in the app)
        const failedIds = new Set(enrolRows.filter((en) => en.moduleId === e.moduleId && en.status === "FAILED").map((en) => en.studentId));
        students = students.filter((s) => failedIds.has(s.id));
      }
      return { examId: e.id, moduleCode: m.code, students };
    });
    const totalStudents = seatExams.reduce((a, e) => a + e.students.length, 0);
    const venues = suggestVenues(venuesLite, totalStudents, busyRooms);
    venues.forEach((v) => busyRooms.add(v.roomId));
    const plan = generateSeating(seatExams, venues);
    for (const e of exams) {
      for (const v of venues) {
        if (plan.assignments.some((a) => a.examId === e.id && a.roomId === v.roomId)) {
          await prisma.examVenue.create({ data: { id: `ev-${e.id}-${v.code}`, examId: e.id, roomId: v.roomId } });
        }
      }
    }
    await chunk(
      plan.assignments.map((a) => ({ id: `seat-${++seatId}`, examId: a.examId, roomId: a.roomId, studentId: a.studentId, seatNo: a.seatNo, row: a.row, col: a.col, label: a.label })),
      (b) => prisma.seatAllocation.createMany({ data: b }),
    );
    // invigilators
    const needs = plan.perVenue.flatMap((pv) => {
      const primaryExam = exams.find((e) => plan.assignments.some((a) => a.roomId === pv.roomId && a.examId === e.id))!;
      return [{ examId: primaryExam.id, moduleId: primaryExam.moduleId, roomId: pv.roomId, roomCode: pv.code, students: pv.used }];
    });
    const lecturers = lecturerIds.map((id) => ({
      id,
      name: lecturerById.get(id)!.name,
      department: lecturerById.get(id)!.department,
      dutyCount: dutyCount.get(id)!,
      teachesModuleIds: new Set(assignmentRows.filter((a) => a.lecturerId === id).map((a) => a.moduleId)),
    }));
    const inv = allocateInvigilators(needs, lecturers);
    for (const a of inv.assignments) {
      dutyCount.set(a.lecturerId, dutyCount.get(a.lecturerId)! + 1);
      await prisma.invigilation.create({ data: { id: `inv-${++invId}`, examId: a.examId, roomId: a.roomId, lecturerId: a.lecturerId, role: a.role } });
    }
    for (const e of exams) await prisma.examSession.update({ where: { id: e.id }, data: { status: inv.shortfall.length ? "SEATED" : "READY" } });
  }
  console.log(`Exams: ${examRows.length}, seats: ${seatId}, invigilations: ${invId}`);

  // ── users ──
  const pw = hash(DEMO_PASSWORD);
  const users: { id: string; email: string; name: string; passwordHash: string; role: string; lecturerId?: string; studentId?: string }[] = [
    { id: "user-admin", email: "admin@islington.edu.np", name: "System Administrator", passwordHash: pw, role: "ADMIN" },
    { id: "user-rte", email: "rte@islington.edu.np", name: "RTE Officer", passwordHash: pw, role: "RTE_STAFF" },
  ];
  LECTURERS.forEach((_, i) => {
    const l = lecturerById.get(`lec-${i + 1}`)!;
    users.push({ id: `user-lec-${i + 1}`, email: l.email, name: l.name, passwordHash: pw, role: "LECTURER", lecturerId: l.id });
  });
  for (const s of studentRows) users.push({ id: `user-${s.id}`, email: s.email, name: `${s.firstName} ${s.lastName}`, passwordHash: pw, role: "STUDENT", studentId: s.id });
  // Friendly demo accounts
  users.push({ id: "user-demo-lect", email: "lecturer@islington.edu.np", name: lecturerById.get("lec-1")!.name, passwordHash: pw, role: "LECTURER" });
  const demoStudent = studentRows.find((s) => s.cohortId === "coh-L5COG1")!;
  users.push({ id: "user-demo-stu", email: "student@islington.edu.np", name: `${demoStudent.firstName} ${demoStudent.lastName}`, passwordHash: pw, role: "STUDENT" });
  await chunk(users, (b) => prisma.user.createMany({ data: b }));
  // link demo accounts (unique constraints: link via update after removing the per-person account)
  await prisma.user.delete({ where: { id: "user-lec-1" } });
  await prisma.user.update({ where: { id: "user-demo-lect" }, data: { lecturerId: "lec-1" } });
  await prisma.user.delete({ where: { id: `user-${demoStudent.id}` } });
  await prisma.user.update({ where: { id: "user-demo-stu" }, data: { studentId: demoStudent.id } });

  await prisma.auditLog.createMany({
    data: [
      { userId: "user-rte", action: "TIMETABLE_GENERATED", entity: "Timetable", entityId: "tt-master", details: JSON.stringify({ placed: result.stats.placed, units: result.stats.units, score: result.score }) },
      { userId: "user-rte", action: "TIMETABLE_PUBLISHED", entity: "Timetable", entityId: "tt-master" },
      { userId: "user-admin", action: "RESULTS_PUBLISHED", entity: "ResultSheet", entityId: "bulk", details: JSON.stringify({ term: TERMS.previous }) },
      { userId: "user-rte", action: "SEATING_GENERATED", entity: "ExamSession", entityId: "exam-resit-CS4004", details: JSON.stringify({ seats: seatId }) },
    ],
  });

  console.log("\nDemo accounts (password: %s)", DEMO_PASSWORD);
  console.log("  admin@islington.edu.np     ADMIN");
  console.log("  rte@islington.edu.np       RTE_STAFF");
  console.log("  lecturer@islington.edu.np  LECTURER (%s)", lecturerById.get("lec-1")!.name);
  console.log("  student@islington.edu.np   STUDENT (%s, %s)", `${demoStudent.firstName} ${demoStudent.lastName}`, demoStudent.studentNo);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
