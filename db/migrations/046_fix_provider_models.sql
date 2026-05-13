-- Migration: 046_fix_provider_models.sql
-- Description: Correct the model column on existing OCP and Codex
--              provider rows so the LLM relay doesn't get rejected by
--              the local CLIs.
--
-- OCP:    "claude-opus" → "claude-opus-4-7"
--         OCP's /v1/models exposes concrete revisions (claude-opus-4-7,
--         claude-sonnet-4-6, …) and rejects the bare alias.
-- Codex:  "codex-default" → "" (empty)
--         Codex CLI does `--model codex-default` → exit status 1 with
--         "Unknown model". Empty value tells the cloud-side relay to
--         skip pushing --model entirely, so the CLI uses its own default.

UPDATE user_provider_configs
SET model = 'claude-opus-4-7',
    updated_at = NOW()
WHERE provider_id = 'ocp'
  AND model IN ('claude-opus', '');

UPDATE user_provider_configs
SET model = '',
    updated_at = NOW()
WHERE provider_id = 'codex'
  AND model = 'codex-default';
