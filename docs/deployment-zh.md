# SayKnowMind 服务器部署指南

新生产域名 **https://sayknowmind.ypai.click**。本文档面向接管该服务器的运维同事。

---

## 1. 环境变量

将下列变量配置到服务器（容器 / systemd / .env / 平台环境变量均可）。**注意：`NEXT_PUBLIC_*` 在构建时会被嵌入到客户端 JS 中，所以必须在打包前设置好，否则浏览器仍会请求旧域名。**

```bash
# ── 核心 ───────────────────────────────────────────
NODE_ENV=production
NEXT_PUBLIC_DEPLOY_MODE=cloud
NEXT_PUBLIC_APP_URL=https://sayknowmind.ypai.click
BETTER_AUTH_URL=https://sayknowmind.ypai.click
TRUSTED_ORIGINS=https://sayknowmind.ypai.click

# ── 密钥（请重新生成，不要复用旧值）────────────────
BETTER_AUTH_SECRET=<openssl rand -base64 32 的结果>
ENCRYPTION_KEY=<openssl rand -hex 32 的结果>
RELAY_SHARED_SECRET=<openssl rand -hex 32 的结果>

# ── 数据库（生产 Postgres 连接串）─────────────────
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/sayknowmind
# 不要在 cloud 环境设置 PGLITE_MODE — 那只用于桌面端
```

### 已使用的 Google OAuth 凭证

Google Cloud 项目沿用现有的，**Client ID / Secret 由开发同事另行通过安全渠道发给您**（不要走聊天明文）：

```bash
GOOGLE_OAUTH_CLIENT_ID=<沿用现有>
GOOGLE_OAUTH_CLIENT_SECRET=<沿用现有>
# 不需要再设置 GOOGLE_OAUTH_REDIRECT_URI —
# 代码会基于 NEXT_PUBLIC_APP_URL 自动拼接成
# https://sayknowmind.ypai.click/api/integrations/connectors/google-drive/oauth/callback
```

### 可选服务（视需要启用）

```bash
# AI 兜底密钥（会员未填自己的 key 时，服务器用这个）
OPENAI_API_KEY=
OPENROUTER_API_KEY=

# AI 服务（如果单独部署 ai-server）
AI_SERVER_URL=https://your-ai-server-host
AI_API_KEY=

# EdgeQuake RAG（如启用）
EDGEQUAKE_URL=
EDGEQUAKE_API_KEY=

# Telegram 机器人（如启用）
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32 的结果>

# 其他
REQUIRE_EMAIL_VERIFICATION=false
PRIVATE_MODE=false
```

---

## 2. 数据库迁移

按顺序对生产 Postgres 执行下列脚本。仓库根目录有 `db/init/` 文件夹。

```bash
psql "$DATABASE_URL" -f db/init/03-init-extensions.sql       # pgvector + uuid-ossp
psql "$DATABASE_URL" -f db/init/04-sayknowmind-init.sql      # documents / entities / vectors
psql "$DATABASE_URL" -f db/init/05-ingestion-jobs.sql
psql "$DATABASE_URL" -f db/init/06-privacy-levels.sql
psql "$DATABASE_URL" -f db/init/07-better-auth.sql           # user / session
psql "$DATABASE_URL" -f db/init/08-relay-sync.sql
psql "$DATABASE_URL" -f db/init/09-sync-ledger.sql
psql "$DATABASE_URL" -f db/init/10-integration-tokens.sql    # 云端连接器 token
psql "$DATABASE_URL" -f db/migrations/038_user_provider_configs.sql  # 会员 LLM 密钥

# better-auth 的 rateLimit 表（代码使用 storage="database"）
psql "$DATABASE_URL" -c 'CREATE TABLE IF NOT EXISTS "rateLimit" (
  id text PRIMARY KEY,
  key text,
  count integer DEFAULT 0,
  "lastRequest" bigint
);'
```

⚠️ **不要执行** `db/init/01-edgequake-init.sql` 和 `db/init/02-init-age-db.sh` —— 这两个脚本依赖 `edgequake` 角色和 Apache AGE 扩展，只在同时部署 EdgeQuake 服务时才需要，否则会失败并阻塞后续脚本。

---

## 3. Google Cloud Console 配置

OAuth 凭证沿用旧的，但 **redirect URI 必须新增生产域名**，否则浏览器登录时 Google 会报 `redirect_uri_mismatch`。

进入 https://console.cloud.google.com/apis/credentials → 编辑现有的 OAuth 2.0 客户端 → **Authorized redirect URIs** 中追加：

```
https://sayknowmind.ypai.click/api/integrations/connectors/google-drive/oauth/callback
https://sayknowmind.ypai.click/api/integrations/connectors/gmail/oauth/callback
```

（如果 Gmail 卡片暂未启用可以不加 Gmail 那行，但加上更省心。）

OAuth 同意屏幕仍是 External + Testing 状态的话，测试用户名单里要加上运营所用的 Google 账号；上线给所有用户用之前请把同意屏幕状态切到 Production。

---

## 4. 构建注意事项

仓库是 pnpm workspace，Web 应用位于 `apps/web`。

```bash
cd apps/web
# 把上面所有环境变量都 export 到当前 shell（特别是 NEXT_PUBLIC_*）
pnpm install
pnpm build       # 这一步会把 NEXT_PUBLIC_* 嵌入到客户端 chunk 中
pnpm start       # 或者 node .next/standalone/server.js
```

或者使用仓库根目录的 `docker-compose.yml` 整套上：

```bash
docker compose up -d
```

但 docker-compose.yml 是为本地开发设计的，生产建议根据需要裁剪（移除 ollama / searxng / ipfs 这些重型容器，只保留 postgres + web）。

---

## 5. 验证清单

部署完成后请人工检查：

1. `https://sayknowmind.ypai.click/` 能打开首页
2. `GET https://sayknowmind.ypai.click/api/auth/get-session` 返回 200（`null` 表示未登录，正常）
3. 浏览器 DevTools 里 **没有 CORS 错误**（即客户端 JS 没有再请求 Railway 域名）
4. 在新设备上注册一个测试账号 → 登录成功
5. Settings → 集成 → Google Drive 卡片点击「Connect」→ 跳转到 Google OAuth 同意页（如果在这里报 `redirect_uri_mismatch`，回到上面第 3 节核对 redirect URI）

---

## 6. 桌面端 ChatGPT / Claude 订阅特性（仅供参考）

会员还可以下载桌面端 (`SayknowMind.dmg` / `SayknowMind Lite.dmg`)，桌面端有两个新的「订阅复用」卡片：

- **ChatGPT 订阅 (Codex)** — 会员自己机器上 `codex login` 一次，桌面端复用本机的 OAuth token，不走云端 API，不消耗服务器额度。
- **Claude 订阅 (OCP)** — 会员自己装本机 OCP 代理，桌面端通过本机 `localhost:3456` 调用 Claude，同样不走服务器。

这两个功能**完全在用户机器上跑**，云端服务器**无需任何额外配置**。云端浏览器版的设置页会自动隐藏这两张卡片。

---

如有疑问联系开发同事。
