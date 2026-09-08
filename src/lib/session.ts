// Edge-safe session token helpers (Web Crypto) — used by middleware and server code.
import type { Role } from "./constants";

export type SessionPayload = {
  uid: string;
  role: Role;
  name: string;
  exp: number; // epoch ms
};

export const SESSION_COOKIE = "rte_session";
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

function secret(): string {
  return process.env.SESSION_SECRET || "rte-hub-dev-secret";
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}

export async function signSession(p: Omit<SessionPayload, "exp">): Promise<string> {
  const payload: SessionPayload = { ...p, exp: Date.now() + SEVEN_DAYS };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(body);
  return `${body}.${sig}`;
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(body);
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
