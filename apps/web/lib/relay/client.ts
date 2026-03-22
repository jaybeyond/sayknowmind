/**
 * Relay HTTP client — talks to the cloud relay server.
 */
import type { RelayPullMessage } from "./types";

const RELAY_TIMEOUT = 15_000;

export class RelayClient {
  constructor(
    private relayUrl: string,
    private relayToken: string,
  ) {}

  private async request(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const url = `${this.relayUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RELAY_TIMEOUT);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.relayToken}`,
          ...options.headers,
        },
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Push an encrypted payload to the relay.
   */
  async push(
    encryptedPayload: string,
    payloadType: string,
    payloadHash: string,
  ): Promise<{ receipt_id: string; expires_at: string }> {
    const res = await this.request("/relay/push", {
      method: "POST",
      body: JSON.stringify({
        encrypted_payload: encryptedPayload,
        payload_type: payloadType,
        payload_hash: payloadHash,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Relay push failed (${res.status}): ${(body as { error?: string }).error ?? res.statusText}`);
    }

    return res.json();
  }

  /**
   * Pull pending messages from the relay.
   */
  async pull(
    since?: string,
    limit = 50,
  ): Promise<{ messages: RelayPullMessage[]; has_more: boolean }> {
    const params = new URLSearchParams();
    if (since) params.set("since", since);
    params.set("limit", String(limit));

    const res = await this.request(`/relay/pull?${params.toString()}`);

    if (!res.ok) {
      throw new Error(`Relay pull failed (${res.status}): ${res.statusText}`);
    }

    return res.json();
  }

  /**
   * Acknowledge receipt of messages (relay will delete them).
   */
  async ack(receiptIds: string[]): Promise<{ acknowledged: number }> {
    const res = await this.request("/relay/ack", {
      method: "POST",
      body: JSON.stringify({ receipt_ids: receiptIds }),
    });

    if (!res.ok) {
      throw new Error(`Relay ack failed (${res.status}): ${res.statusText}`);
    }

    return res.json();
  }

  /**
   * Get relay status for the current user.
   */
  async status(): Promise<{
    pending_count: number;
    oldest_pending: string | null;
    storage_used_bytes: number;
  }> {
    const res = await this.request("/relay/status");

    if (!res.ok) {
      throw new Error(`Relay status failed (${res.status}): ${res.statusText}`);
    }

    return res.json();
  }

  /**
   * Health check — no auth required.
   */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.relayUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
