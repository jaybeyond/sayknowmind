/**
 * SayKnowMind Cloud Relay Server
 *
 * Encrypted temporary storage for offline sync.
 * The relay never decrypts payloads — it's a dumb pipe.
 */
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { Pool } from "pg";
import { createRelayApp } from "./server.js";
import { startPurgeJob } from "./cleanup/ttl-purge.js";
import { createCollabServer } from "./collab/hocuspocus.js";

const PORT = parseInt(process.env.PORT ?? "3200", 10);
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:password@localhost:5432/sayknowmind";

const pool = new Pool({ connectionString: DATABASE_URL });

// Verify DB connection
try {
  await pool.query("SELECT 1");
  console.log("[relay] Database connected");
} catch (err) {
  console.error("[relay] Database connection failed:", err);
  process.exit(1);
}

const app = createRelayApp(pool);

// Start TTL purge job (every 15 minutes)
const purgeInterval = parseInt(
  process.env.PURGE_INTERVAL_MS ?? `${15 * 60 * 1000}`,
  10,
);
startPurgeJob(pool, purgeInterval);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[relay] SayKnowMind Cloud Relay running on port ${info.port}`);
  console.log(`[relay] Health: http://localhost:${info.port}/health`);
  console.log(`[relay] Collab WS: ws://localhost:${info.port}/collab`);
});

// Real-time collaboration (Yjs). The HocuspocusProvider connects to /collab and
// sends the document name in-band (Yjs protocol), NOT in the URL path — so we
// accept any /collab* upgrade and let Hocuspocus resolve the document + auth.
const collab = createCollabServer(pool);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = request.url ?? "";
  if (!url.startsWith("/collab")) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    collab.handleConnection(ws, request);
  });
});
