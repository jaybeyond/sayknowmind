import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Routes that bypass auth even if under a protected prefix
const publicApiPaths = [
  "/api/documents/reprocess",
  "/api/knowledge/graph",
  "/api/knowledge/node",
];

// Routes that require authentication
const protectedPaths = [
  "/settings",
  "/favorites",
  "/archive",
  "/trash",
  "/api/ingest",
  "/api/search",
  "/api/chat",
  "/api/categories",
  "/api/knowledge",
  "/api/documents",
  "/api/sync",
  "/knowledge",
  "/categories",
];

// Routes that should redirect to home if already authenticated
const authPaths = ["/login", "/signup"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);

  // Protected routes: redirect to login if no session
  const isPublicApi = publicApiPaths.some((path) => pathname.startsWith(path));
  const isProtected =
    !isPublicApi &&
    (pathname === "/" ||
    protectedPaths.some((path) => pathname.startsWith(path)));
  if (isProtected && !sessionCookie) {
    // API routes return 401, page routes redirect to login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { code: 1002, message: "Unauthorized", timestamp: new Date().toISOString() },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Auth routes: redirect to home if already authenticated
  const isAuthPath = authPaths.some((path) => pathname.startsWith(path));
  if (isAuthPath && sessionCookie) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const response = NextResponse.next();
  response.headers.set("x-request-id", crypto.randomUUID());
  return response;
}

export const config = {
  matcher: [
    // Dashboard (require auth)
    "/",
    "/favorites",
    "/archive",
    "/trash",
    // Protected pages
    "/settings/:path*",
    "/knowledge/:path*",
    "/categories/:path*",
    "/chat/:path*",
    "/chat",
    // Protected API routes
    "/api/ingest/:path*",
    "/api/search/:path*",
    "/api/chat",
    "/api/chat/:path*",
    "/api/categories/:path*",
    "/api/knowledge/:path*",
    "/api/documents/:path*",
    "/api/sync/:path*",
    // Auth pages (redirect if logged in)
    "/login",
    "/signup",
  ],
};
