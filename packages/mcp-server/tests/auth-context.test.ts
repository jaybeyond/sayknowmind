import { describe, expect, it } from "vitest";
import {
  rejectUserScopedEdgeQuakeTool,
  requestContext,
} from "../src/auth-context.js";

describe("MCP auth context isolation gate", () => {
  it("allows direct EdgeQuake tools without a per-user request context", () => {
    expect(rejectUserScopedEdgeQuakeTool()).toBeNull();
  });

  it("rejects direct EdgeQuake tools for per-user MCP API keys", () => {
    const rejected = requestContext.run(
      { userId: "user-123", rawToken: "sk-mcp-test", isAdmin: false },
      () => rejectUserScopedEdgeQuakeTool(),
    );

    expect(rejected?.isError).toBe(true);
    const content = rejected?.content[0];
    expect(content?.type).toBe("text");
    const body = JSON.parse(content?.text ?? "{}");
    expect(body).toMatchObject({
      error: "user_isolation_unimplemented",
      status: 403,
    });
  });
});
