import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ ok: true, msg: "auth test route works" });
}
