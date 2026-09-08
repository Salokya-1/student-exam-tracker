import { signSession } from "../src/lib/session";
(async () => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "rte-hub-dev-secret-change-me";
  const token = await signSession({ uid: "user-admin", role: "ADMIN", name: "System Administrator" });
  const routes = ["/dashboard", "/students", "/students/stu-20250098", "/results", "/results/sheet-L5COG1-CS4005", "/timetable", "/timetable?tt=tt-legacy&view=all", "/exams", "/exams/exam-CS4001", "/faculty", "/faculty/lec-1", "/rooms", "/rooms/room-1", "/audit", "/assistant", "/timetable/session/new?tt=tt-master"];
  for (const r of routes) {
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const res = await fetch("http://localhost:3000" + r, { headers: { cookie: `rte_session=${token}` }, redirect: "manual" });
      await res.text();
      times.push(Date.now() - t0);
      if (res.status !== 200) console.log("  status", res.status, r);
    }
    console.log(r.padEnd(42), times.map((t) => String(t).padStart(6)).join(" "), "ms (1st incl. compile)");
  }
})();
