import { runAgent } from "../src/lib/agent/run";
import { prisma } from "../src/lib/prisma";
const admin = { id: "user-admin", email: "admin@islington.edu.np", name: "System Administrator", role: "ADMIN" as const, lecturerId: null, studentId: null };
(async () => {
  for (const q of ["Which sheets are waiting for approval?", "Prepare the CS5002 exam", "What should I do next on the timetable page?"]) {
    const r = await runAgent([{ role: "user", content: q }], admin, "/dashboard");
    console.log(`\nQ: ${q}\n[${r.engine} · ${r.ms} ms · tools: ${r.tools.map((t) => `${t.name}${t.ok ? "" : "(FAIL:" + t.summary + ")"}`).join(", ") || "none"}${r.navigateTo ? " · nav " + r.navigateTo : ""}]\n${r.reply}`);
  }
  await prisma.$disconnect();
})();
