import { loadDemands, loadRoomsLite, loadSlots } from "../src/lib/data/timetable";
import { generateTimetable } from "../src/lib/engine/scheduler";
import { prisma } from "../src/lib/prisma";
(async () => {
  const [d, r, s] = await Promise.all([loadDemands(), loadRoomsLite(), loadSlots()]);
  for (const seed of [7, 9]) {
    const t0 = Date.now();
    const res = generateTimetable(d, r, s, { seed });
    console.log(`seed ${seed}: ${Date.now() - t0} ms · placed ${res.stats.placed}/${res.stats.units} · clashes ${res.stats.clashes} · score ${res.score}`);
  }
  await prisma.$disconnect();
})();
