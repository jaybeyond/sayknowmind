import { NextResponse } from "next/server";
import { BiTaskBridgeError } from "@/lib/integrations/bi-tasks";
import { ErrorCode } from "@/lib/types";

export function biTaskErrorResponse(error: unknown) {
  const status = error instanceof BiTaskBridgeError ? error.status : 500;
  const code = status === 403
    ? ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS
    : status === 400 || status === 404 || status === 409
      ? ErrorCode.SYSTEM_VALIDATION_ERROR
      : status === 502 || status === 503
        ? ErrorCode.SYSTEM_NETWORK_ERROR
        : ErrorCode.SYSTEM_INTERNAL_ERROR;
  const message = error instanceof BiTaskBridgeError ? error.message : "Internal server error";

  return NextResponse.json(
    { code, message, timestamp: new Date().toISOString() },
    { status },
  );
}
