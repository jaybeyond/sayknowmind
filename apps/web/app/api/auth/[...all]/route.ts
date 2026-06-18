import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { isSaasAuth } from "@/lib/auth-mode";

const handler = toNextJsHandler(auth);

export const GET = handler.GET;

// Enterprise (saas) edition: credentials live in SayKnowWork SaaS. Local
// email/password sign-in/up are only used in-process by /api/auth/external-login
// (via auth.api.*), never over HTTP — block the public HTTP endpoints so nobody
// bypasses SaaS and creates a local-only account. The Open (local) edition uses
// built-in better-auth login, so these stay open there. get-session, sign-out,
// organization/* … always stay open.
const BLOCKED_PATHS = ["/sign-in/email", "/sign-up/email"];

export async function POST(request: Request) {
  const path = new URL(request.url).pathname;
  if (isSaasAuth && BLOCKED_PATHS.some((p) => path.endsWith(p))) {
    return new Response(JSON.stringify({ error: "Use the sign-in page." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    return await handler.POST!(request);
  } catch (err) {
    console.error("[auth] POST error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
