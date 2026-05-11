/**
 * Codex SDK client — uses the user's ChatGPT subscription (via `codex login`)
 * to call OpenAI models without an API key.
 *
 * Design constraint: this only works on the user's own machine (desktop /
 * Tauri shell) because the SDK reads credentials from `~/.codex/auth.json`
 * or the OS keyring. On a multi-tenant cloud server those credentials do
 * not exist for the requesting member, so `isCodexReady()` returns false
 * and the caller should fall back to another provider.
 *
 * We always run the underlying agent in read-only sandbox with approvals
 * disabled and network access off, because we are using Codex purely as a
 * chat-completion endpoint, not as a coding agent that should touch the
 * filesystem.
 */

import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

let cachedClient: import("@openai/codex-sdk").Codex | null = null;
let cachedReady: boolean | null = null;

function authJsonPath(): string {
  return join(homedir(), ".codex", "auth.json");
}

/**
 * True when the local machine has a usable Codex login (file-based auth).
 * Keyring-only logins won't be detected by this check; callers that need
 * full coverage can attempt a call and treat the error as "not ready".
 */
export function isCodexReady(): boolean {
  if (cachedReady !== null) return cachedReady;
  cachedReady = existsSync(authJsonPath());
  return cachedReady;
}

/** Clear the cached readiness flag — call this after `codex login` events. */
export function invalidateCodexReadyCache(): void {
  cachedReady = null;
}

async function getClient(): Promise<import("@openai/codex-sdk").Codex> {
  if (cachedClient) return cachedClient;
  // Lazy-loaded so cloud builds that never use Codex don't pay the import cost.
  const { Codex } = await import("@openai/codex-sdk");
  cachedClient = new Codex();
  return cachedClient;
}

export interface CodexChatOptions {
  /** Model override. Defaults to whatever Codex is configured to use. */
  model?: string;
  /**
   * Working directory passed to the agent. Defaults to the OS tmpdir so the
   * agent never sees the user's project files. The directory does not need
   * to be a Git repository — we always pass `skipGitRepoCheck`.
   */
  workingDirectory?: string;
}

/**
 * Send a single prompt to Codex and return the final text response.
 *
 * Throws if Codex is not authenticated; callers should consult
 * `isCodexReady()` and fall back to another provider when false.
 */
export async function codexChat(
  prompt: string,
  options: CodexChatOptions = {},
): Promise<string> {
  if (!isCodexReady()) {
    throw new Error(
      "Codex not authenticated — run `codex login` on this machine to sign in with ChatGPT.",
    );
  }

  const codex = await getClient();
  const thread = codex.startThread({
    model: options.model,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    networkAccessEnabled: false,
    webSearchEnabled: false,
    workingDirectory: options.workingDirectory ?? tmpdir(),
  });

  const turn = await thread.run(prompt);
  return turn.finalResponse ?? "";
}
