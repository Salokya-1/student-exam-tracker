import { runAgent, type ChatMessage } from "../src/lib/agent/run";
import { prisma } from "../src/lib/prisma";
const admin = { id: "user-admin", email: "admin@islington.edu.np", name: "System Administrator", role: "ADMIN" as const, lecturerId: null, studentId: null };
(async () => {
  for (const st of await prisma.student.findMany({ where: { firstName: "Test", lastName: "Sharma" } })) {
    await prisma.$transaction([prisma.mark.deleteMany({ where: { enrollment: { studentId: st.id } } }), prisma.moduleEnrollment.deleteMany({ where: { studentId: st.id } }), prisma.user.deleteMany({ where: { studentId: st.id } }), prisma.student.delete({ where: { id: st.id } }), prisma.cohort.update({ where: { id: st.cohortId }, data: { size: { decrement: 1 } } })]);
  }
  await prisma.room.deleteMany({ where: { code: "LB-107" } });
  const history: ChatMessage[] = [];
  for (const q of [
    "Create a new student called Test Sharma in group L4COG1",
    "Enter coursework 70 and examination 65 for Test Sharma in CS4001 on a new draft sheet for L4COG1 if needed",
    "Add a seminar room LB-107 with 24 seats in London Block, 4 rows of 6",
    "Delete the student Test Sharma — yes, go ahead",
  ]) {
    history.push({ role: "user", content: q });
    const r = await runAgent(history, admin, "/students");
    history.push({ role: "assistant", content: r.reply });
    console.log(`\nQ: ${q}\n[${r.engine} · ${r.ms} ms · tools: ${r.tools.map((t) => `${t.name}${t.ok ? "" : "(FAIL:" + t.summary + ")"}`).join(", ") || "none"}]\n${r.reply}`);
  }
  await prisma.$disconnect();
})();
