import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { isBiTasksEnabled, listBiTaskProjects } from "@/lib/integrations/bi-tasks";
import { biTaskErrorResponse } from "@/lib/tasks/bridge-error";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  if (!isBiTasksEnabled(ctx)) {
    return NextResponse.json({ mode: "local", projects: [] });
  }

  try {
    const projects = await listBiTaskProjects(ctx);
    return NextResponse.json({ mode: "bi", projects });
  } catch (error) {
    console.error("[tasks/projects] GET error:", error);
    return biTaskErrorResponse(error);
  }
}
