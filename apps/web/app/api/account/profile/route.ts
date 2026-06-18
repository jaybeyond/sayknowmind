import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSession } from "@/lib/admin";
import { updateSaasProfile } from "@/lib/saas-auth";
import { auth } from "@/lib/auth";

/**
 * PATCH /api/account/profile — update the signed-in user's display name on
 * SayKnowWork, then mirror it onto the local shadow record so the session/UI
 * reflect it immediately. Email is the SaaS login identifier and is not editable
 * here.
 */
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { displayName?: string };
  const displayName = (body.displayName ?? "").trim();
  if (!displayName) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  const result = await updateSaasProfile(email, displayName);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message ?? "Profile update failed", code: result.code },
      { status: result.status >= 500 ? 502 : 400 },
    );
  }

  // Mirror onto the local shadow so the session reflects the new name now.
  try {
    await auth.api.updateUser({ body: { name: displayName }, headers: await headers() });
  } catch {
    // best-effort — SaaS is the source of truth
  }

  return NextResponse.json({ ok: true });
}
