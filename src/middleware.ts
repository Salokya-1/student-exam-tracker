import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const PUBLIC = ["/login", "/api/health"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));

  if (!session && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (session && pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = session.role === "STUDENT" ? "/me" : "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (session && pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = session.role === "STUDENT" ? "/me" : "/dashboard";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico|webp)).*)"],
};
