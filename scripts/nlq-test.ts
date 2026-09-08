import { classify, execute } from "../src/lib/engine/nlq";
const qs = [
  "Where is 20250098 sitting?",
  "Timetable for L5COG1 on Monday",
  "Which rooms are free on Tuesday at 10 for 40 students?",
  "Workload of Sunita Maharjan",
  "Pass rate for CS4005",
  "Any clashes in the timetable?",
  "At-risk students in L6COG1",
  "When is the CS5001 exam?",
  "Least used rooms",
  "Is LB-201 free on Wednesday at 9?",
  "who is overloaded",
  "profile of 20250098",
];
(async () => {
  for (const q of qs) {
    const c = classify(q);
    const t0 = Date.now();
    const a = await execute(c.intent, c.params);
    console.log(`\nQ: ${q}\n   intent=${c.intent} params=${JSON.stringify(c.params)} (${Date.now() - t0}ms)\n   A: ${a.answer.slice(0, 220)}${a.rows ? ` [rows=${a.rows.data.length}]` : ""}`);
  }
  process.exit(0);
})();
