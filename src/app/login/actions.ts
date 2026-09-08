"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    redirect(`/login?error=${encodeURIComponent("Invalid email or password")}`);
  }
  await createSession(user);
  await audit(user.id, "LOGIN", "User", user.id);
  const dest = next && next.startsWith("/") && next !== "/login" ? next : user.role === "STUDENT" ? "/me" : "/dashboard";
  redirect(dest);
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
