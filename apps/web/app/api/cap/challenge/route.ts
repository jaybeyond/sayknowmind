import { NextResponse } from "next/server";
import { cap } from "@/lib/cap";

export async function POST() {
  const challenge = await cap.createChallenge();
  return NextResponse.json(challenge);
}
