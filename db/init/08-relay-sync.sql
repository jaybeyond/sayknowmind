-- Cloud Relay Sync — relay_messages table
-- Stores E2E encrypted blobs temporarily (24h TTL) for offline sync.
-- The relay server never decrypts payloads.

CREATE TABLE IF NOT EXISTS relay_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    encrypted_payload TEXT NOT NULL,
    payload_type VARCHAR(50) NOT NULL DEFAULT 'document',
    payload_hash TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_at TIMESTAMP
);

-- Fast lookup for pending messages per user
CREATE INDEX IF NOT EXISTS idx_relay_messages_user_pending
    ON relay_messages(user_id, created_at ASC)
    WHERE acknowledged = FALSE;

-- TTL purge job scans this index
CREATE INDEX IF NOT EXISTS idx_relay_messages_expires
    ON relay_messages(expires_at)
    WHERE acknowledged = FALSE;

-- Deduplication: same user + same payload hash = skip
CREATE INDEX IF NOT EXISTS idx_relay_messages_dedup
    ON relay_messages(user_id, payload_hash);
