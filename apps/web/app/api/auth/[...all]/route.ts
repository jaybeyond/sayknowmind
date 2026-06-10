import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

const handler = toNextJsHandler(auth);

export const GET = handler.GET;

// Credentials live in SayKnowWork SaaS. Local email/password sign-in and
// sign-up are only used in-process by /api/auth/external-login (via auth.api.*),
// never over HTTP — so we block the public HTTP endpoints to stop anyone from
// bypassing SaaS and creating a local-only account. Everything else
// (get-session, sign-out, organization/* …) stays open.
const BLOCKED_PATHS = ["/sign-in/email", "/sign-up/email"];

export async function POST(request: Request) {
  const path = new URL(request.url).pathname;
  if (BLOCKED_PATHS.some((p) => path.endsWith(p))) {
    return new Response(JSON.stringify({ error: "Use SayKnowWork sign-in." }), {
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
