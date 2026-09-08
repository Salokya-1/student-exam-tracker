// End-to-end check of in-place server actions in a real (headless Edge) browser.
// Run: npx tsx scripts/e2e-actions.ts  (server must be running on :3000)
import { chromium } from "playwright";
import { signSession } from "../src/lib/session";

const BASE = process.env.BASE_URL || "http://localhost:3000";

(async () => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "rte-hub-dev-secret-change-me";
  const token = await signSession({ uid: "user-admin", role: "ADMIN", name: "System Administrator" });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addCookies([{ name: "rte_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  // 1. exam venue allocation — page must stay on screen, toast must appear, status must change
  await page.goto(`${BASE}/exams/exam-CS6003`, { waitUntil: "networkidle" });
  const before = await page.locator("main").innerText();
  const t0 = Date.now();
  await page.getByRole("button", { name: /auto-allocate venues/i }).click();
  const toast = page.locator("[role=status]");
  await toast.waitFor({ timeout: 15000 });
  const toastText = await toast.innerText();
  await page.waitForFunction(() => /VENUES ALLOCATED/.test(document.body.innerText), null, { timeout: 15000 });
  const btn = await page.getByRole("button", { name: /auto-allocate venues|working/i }).innerText();
  console.log(`[exam] toast after ${Date.now() - t0} ms: ${toastText.replace(/\n/g, " ")}`);
  console.log(`[exam] button now: "${btn}" · url ${page.url()} · main non-empty throughout: ${before.length > 500}`);

  // 2. timetable solver — returns redirectTo, client must navigate to the new draft
  await page.goto(`${BASE}/timetable`, { waitUntil: "networkidle" });
  await page.locator("summary", { hasText: /generate clash-free option/i }).click();
  const t1 = Date.now();
  await page.getByRole("button", { name: /run solver/i }).click();
  await page.waitForURL(/report=1/, { timeout: 20000 });
  await page.waitForFunction(() => /Generation report/.test(document.body.innerText), null, { timeout: 15000 });
  console.log(`[timetable] navigated to ${page.url()} after ${Date.now() - t1} ms`);

  // 3. results workflow — approve a submitted sheet in place
  const submitted = await (await fetch(`${BASE}/api/health`)).ok; // server reachable
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const sheet = await prisma.resultSheet.findFirst({ where: { status: "SUBMITTED" } });
  await prisma.$disconnect();
  if (!sheet || !submitted) throw new Error("no SUBMITTED sheet to approve — reseed first");
  await page.goto(`${BASE}/results/${sheet.id}`, { waitUntil: "networkidle" });
  const t2 = Date.now();
  await page.getByRole("button", { name: /^approve$/i }).click();
  await page.waitForFunction(() => /is now APPROVED/.test(document.querySelector("[role=status]")?.textContent ?? ""), null, { timeout: 15000 });
  console.log(`[results] approved in ${Date.now() - t2} ms · url ${page.url()}`);

  console.log("console errors:", errors.length ? errors : "none");
  await browser.close();
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
