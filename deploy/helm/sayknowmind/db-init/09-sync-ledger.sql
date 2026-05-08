-- Sync Ledger — tracks local changes that need relay sync.
-- Each row = one document change event (create/update/delete).

CREATE TABLE IF NOT EXISTS sync_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    entity_type VARCHAR(50) NOT NULL DEFAULT 'document',
    payload_hash TEXT,
    relay_receipt_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'pushed', 'pulled', 'confirmed', 'failed')),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    synced_at TIMESTAMP
);

-- Pending entries waiting to be pushed to relay
CREATE INDEX IF NOT EXISTS idx_sync_ledger_user_pending
    ON sync_ledger(user_id, created_at ASC)
    WHERE status = 'pending';

-- Pushed entries waiting for confirmation
CREATE INDEX IF NOT EXISTS idx_sync_ledger_user_pushed
    ON sync_ledger(user_id)
    WHERE status = 'pushed';
