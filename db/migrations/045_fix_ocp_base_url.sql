-- Migration: 045_fix_ocp_base_url.sql
-- Description: Strip trailing /v1 from OCP provider entries so cloud-ai.ts
--              and cloud-chat.ts can append /v1/chat/completions cleanly,
--              matching the OpenRouter/OpenAI base_url convention.
-- Background: Previously the OCP activation route stored base_url as
--              "http://127.0.0.1:3456/v1", which composed to
--              "http://127.0.0.1:3456/v1/v1/chat/completions" — a 404 path.

UPDATE user_provider_configs
SET base_url = regexp_replace(base_url, '/v1/?$', ''),
    updated_at = NOW()
WHERE provider_id = 'ocp'
  AND base_url LIKE '%/v1';
