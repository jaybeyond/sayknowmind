-- Migration: 048_fix_codex_chatgpt_models.sql
-- Description: Reset Codex model IDs that ChatGPT-account Codex rejects.
--
-- Codex authenticated with a ChatGPT subscription does not accept plain API
-- model IDs such as `gpt-5`; passing those through `codex exec --model`
-- fails the whole relay request. Empty string means the relay omits --model
-- and lets Codex choose its account-supported default.

UPDATE user_provider_configs
SET model = '',
    updated_at = NOW()
WHERE provider_id = 'codex'
  AND model IN ('codex-default', 'gpt-5', 'gpt-5-mini');
