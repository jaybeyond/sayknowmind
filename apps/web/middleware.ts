import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { getSecurityHeaders } from "@/lib/security/headers";

// Routes that bypass auth even if under a protected prefix
const publicApiPaths = [
  "/api/integrations/telegram/webhook",
  "/api/share/view",
  "/api/share/gallery",
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
  "/api/conversations",
  "/api/categories",
  "/api/tags",
  "/api/knowledge",
  "/api/documents",
  "/api/tasks",
  "/api/presence",
  "/api/sync",
  "/api/services",
  "/api/models",
  "/api/integrations/telegram",
  "/api/admin",
  "/api/share",
  "/knowledge",
  "/categories",
  "/published",
  "/tasks",
];

// Routes that should redirect to home if already authenticated
const authPaths = ["/login", "/signup"];

const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN ?? "http://localhost:3001";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": DASHBOARD_ORIGIN,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

function withCors(response: NextResponse, origin: string | null): NextResponse {
  if (origin === DASHBOARD_ORIGIN) {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      response.headers.set(key, value);
    }
  }
  return response;
}

// Both per-user MCP API keys (`sk-mcp-...` rows in user_mcp_keys) AND
// better-auth bearer tokens (used by the native Flutter app, which is
// cookieless) authenticate via the `Authorization: Bearer ...` header instead
// of the session cookie. The middleware can't validate either cheaply on every
// request (MCP keys need a DB lookup; better-auth tokens need the auth
// pipeline), so the presence of a Bearer token defers auth to the route
// handler. `getUserIdFromRequest()` / `getOrgContext()` resolve the token to a
// user — `auth.api.getSession()` is bearer-aware via the bearer() plugin, with
// an MCP-key fallback — or return null → 401. Without this, the Flutter app
// (no cookie, non-`sk-mcp-` token) was 401'd at the edge before the handler
// ever saw the valid bearer token.
function hasBearerToken(request: NextRequest): boolean {
  const auth = request.headers.get("authorization");
  if (!auth) return false;
  return /^Bearer\s+\S+/i.test(auth);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get("origin");
  const sessionCookie = getSessionCookie(request);
  const bearerAuth = hasBearerToken(request);

  // Handle CORS preflight from dashboard
  if (request.method === "OPTIONS" && origin === DASHBOARD_ORIGIN) {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  // Protected routes: redirect to login if no session
  const isPublicApi = publicApiPaths.some((path) => pathname.startsWith(path));
  const isProtected =
    !isPublicApi &&
    protectedPaths.some((path) => pathname.startsWith(path));
  if (isProtected && !sessionCookie && !bearerAuth) {
    // API routes return 401, page routes redirect to login
    if (pathname.startsWith("/api/")) {
      return withCors(
        NextResponse.json(
          { code: 1002, message: "Unauthorized", timestamp: new Date().toISOString() },
          { status: 401 }
        ),
        origin,
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

  // Apply OWASP security headers
  const securityHeaders = getSecurityHeaders({
    allowInlineScripts: true,
    connectSrcDomains: (process.env.TRUSTED_ORIGINS ?? "").split(",").filter(Boolean),
  });
  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }

  return withCors(response, origin);
}

export const config = {
  matcher: [
    // Dashboard (require auth)
    "/favorites",
    "/archive",
    "/trash",
    // Protected pages
    "/settings/:path*",
    "/knowledge/:path*",
    "/categories/:path*",
    "/tasks/:path*",
    "/tasks",
    "/chat/:path*",
    "/chat",
    // Protected API routes
    "/api/ingest/:path*",
    "/api/search/:path*",
    "/api/chat",
    "/api/chat/:path*",
    "/api/conversations",
    "/api/conversations/:path*",
    "/api/categories/:path*",
    "/api/knowledge/:path*",
    "/api/documents/:path*",
    "/api/tasks",
    "/api/tasks/:path*",
    "/api/presence",
    "/api/sync/:path*",
    "/api/services/:path*",
    "/api/models",
    "/api/models/:path*",
    "/api/integrations/:path*",
    "/api/admin/:path*",
    "/api/share/:path*",
    "/published",
    // Auth pages (redirect if logged in)
    "/login",
    "/signup",
  ],
};
