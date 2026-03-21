import { NextRequest, NextResponse } from "next/server";
import { cap } from "@/lib/cap";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const result = await cap.redeemChallenge(body);
  return NextResponse.json(result);
}
