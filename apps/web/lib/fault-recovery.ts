/**
 * System Fault Recovery
 *
 * - Database connection auto-reconnect (up to 5 retries)
 * - Query timeout (10s) with automatic rollback
 * - Data integrity preservation during recovery
 */

// Dynamic import — pg has native bindings that Turbopack can't bundle
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pg = require("pg");
const Pool = pg.Pool as typeof import("pg").Pool;
type Pool = import("pg").Pool;
type PoolClient = import("pg").PoolClient;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 1000;
const QUERY_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Resilient Pool
// ---------------------------------------------------------------------------

export interface ResilientPoolConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  maxRetries?: number;
  queryTimeoutMs?: number;
}

export class ResilientPool {
  private pool: Pool;
  private maxRetries: number;
  private queryTimeoutMs: number;
  private reconnectAttempts = 0;

  constructor(config: ResilientPoolConfig = {}) {
    this.maxRetries = config.maxRetries ?? MAX_RETRIES;
    this.queryTimeoutMs = config.queryTimeoutMs ?? QUERY_TIMEOUT_MS;

    this.pool = new Pool({
      connectionString:
        config.connectionString ??
        process.env.DATABASE_URL ??
        "postgres://postgres:password@localhost:5432/sayknowmind",
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: this.queryTimeoutMs,
    });

    this.pool.on("error", (err) => {
      console.error("[fault-recovery] Pool error:", err.message);
      this.handlePoolError();
    });
  }

  /**
   * Execute a query with auto-reconnect and timeout.
   */
  async query<T = unknown>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.pool.query(text, params);
        this.reconnectAttempts = 0; // Reset on success
        return { rows: result.rows as T[], rowCount: result.rowCount };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isConnectionError = this.isConnectionError(lastError);

        if (!isConnectionError) {
          // Non-connection errors (syntax, constraint) — don't retry
          throw lastError;
        }

        console.warn(
          `[fault-recovery] Query failed (attempt ${attempt + 1}/${this.maxRetries + 1}):`,
          lastError.message,
        );

        if (attempt < this.maxRetries) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new FaultRecoveryError(
      `Query failed after ${this.maxRetries + 1} attempts: ${lastError?.message}`,
    );
  }

  /**
   * Execute a transaction with automatic rollback on failure.
   */
  async transaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.getClient();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = $1", [String(this.queryTimeoutMs)]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get a client with retry logic.
   */
  private async getClient(): Promise<PoolClient> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.pool.connect();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `[fault-recovery] Connection failed (attempt ${attempt + 1}):`,
          lastError.message,
        );

        if (attempt < this.maxRetries) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new FaultRecoveryError(
      `Connection failed after ${this.maxRetries + 1} attempts: ${lastError?.message}`,
    );
  }

  private isConnectionError(err: Error): boolean {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("connection refused") ||
      msg.includes("connection terminated") ||
      msg.includes("connect etimedout") ||
      msg.includes("connection reset") ||
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("the database system is starting up") ||
      msg.includes("too many clients") ||
      msg.includes("remaining connection slots")
    );
  }

  private handlePoolError(): void {
    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxRetries) {
      console.error("[fault-recovery] Max reconnect attempts exceeded");
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class FaultRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaultRecoveryError";
  }
}
