import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Passwords (scrypt, no native deps). Kept free of "server-only" so scripts can import it.
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(pw, salt, 64);
  const ref = Buffer.from(hash, "hex");
  return ref.length === test.length && timingSafeEqual(ref, test);
}
