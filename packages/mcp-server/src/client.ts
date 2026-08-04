/**
 * EdgeQuake SDK client factory — singleton per MCP session.
 *
 * On first use, if no tenant/workspace is configured via environment variables,
 * the client auto-discovers the default tenant and workspace from the server.
 */
import { EdgeQuake } from "edgequake-sdk";
import { resolveConfig, type McpConfig } from "./config.js";

let _client: EdgeQuake | null = null;
let _config: McpConfig | null = null;
let _initialized = false;

const BOOTSTRAP_TIMEOUT_MS = 3000;

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    // Without this the timer stays pending for its full duration after the
    // operation settles — up to 60s of dead timers per upload.
    if (timer) clearTimeout(timer);
  }
}

/**
 * Get the EdgeQuake client. On first call, auto-discovers tenant/workspace
 * if not already configured. Must be awaited.
 */
export async function getClient(): Promise<EdgeQuake> {
  if (!_initialized) {
    _config = resolveConfig();

    // Create a bootstrap client to discover tenant/workspace if needed
    const bootstrap = new EdgeQuake({
      baseUrl: _config.baseUrl,
      apiKey: _config.apiKey,
    });

    // Auto-discover tenant
    if (!_config.defaultTenant) {
      try {
        const tenants = await withTimeout(
          bootstrap.tenants.list(),
          BOOTSTRAP_TIMEOUT_MS,
          "tenant auto-discovery",
        );
        if (tenants.length > 0) {
          _config.defaultTenant = tenants[0].id;

          // Security warning: Multi-tenant auto-discovery
          if (tenants.length > 1) {
            console.warn(
              "[EdgeQuake MCP] ⚠️  WARNING: Multiple tenants detected. Auto-selected first tenant.\n" +
                `  Using tenant: ${_config.defaultTenant}\n` +
                "  To avoid data isolation issues, explicitly set EDGEQUAKE_DEFAULT_TENANT.\n" +
                "  See: https://github.com/raphaelmansuy/edgequake/tree/edgequake-main/mcp#multi-tenant-isolation",
            );
          }
        }
      } catch {
        // Ignore — will fail later with a clear error when tools are called
      }
    }

    // Auto-discover workspace
    if (!_config.defaultWorkspace && _config.defaultTenant) {
      try {
        const workspaces = await withTimeout(
          bootstrap.tenants.listWorkspaces(_config.defaultTenant),
          BOOTSTRAP_TIMEOUT_MS,
          "workspace auto-discovery",
        );
        if (workspaces.length > 0) {
          _config.defaultWorkspace = workspaces[0].id;

          // Security warning: Multi-workspace auto-discovery
          if (workspaces.length > 1) {
            console.warn(
              "[EdgeQuake MCP] ⚠️  WARNING: Multiple workspaces detected. Auto-selected first workspace.\n" +
                `  Using workspace: ${_config.defaultWorkspace}\n` +
                "  To avoid data isolation issues, explicitly set EDGEQUAKE_DEFAULT_WORKSPACE.\n" +
                "  See: https://github.com/raphaelmansuy/edgequake/tree/edgequake-main/mcp#multi-tenant-isolation",
            );
          }
        }
      } catch {
        // Ignore
      }
    }

    _client = new EdgeQuake({
      baseUrl: _config.baseUrl,
      apiKey: _config.apiKey,
      tenantId: _config.defaultTenant,
      workspaceId: _config.defaultWorkspace,
    });

    _initialized = true;
  }
  return _client!;
}

export function getConfig(): McpConfig {
  if (!_config) {
    _config = resolveConfig();
  }
  return _config;
}
