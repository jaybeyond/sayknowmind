import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin";
import { changeSaasPassword } from "@/lib/saas-auth";

/**
 * POST /api/account/change-password — change the signed-in user's password on
 * SayKnowWork (the SaaS is the source of truth; the local shadow password is
 * rotated on every login, so changing it here would be meaningless). The current
 * password authenticates the change.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
  };
  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";
  if (!currentPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "Invalid password" }, { status: 400 });
  }

  const result = await changeSaasPassword(email, currentPassword, newPassword);
  if (!result.ok) {
    const status = result.status === 401 ? 401 : result.status >= 500 ? 502 : 400;
    return NextResponse.json(
      { error: result.message ?? "Password change failed", code: result.code },
      { status },
    );
  }
  return NextResponse.json({ ok: true });
}
