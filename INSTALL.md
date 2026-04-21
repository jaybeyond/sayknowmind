# SayKnowMind Installation and Setup Guide

## Overview

SayKnowMind is a full-stack agentic second brain application with local AI capabilities, knowledge graph storage, and multi-platform support. It combines Next.js web frontend, NestJS AI backend, Rust-based RAG engine (EdgeQuake), web crawler (ZeroClaw), MCP server, encrypted sync relay, and desktop/mobile apps.

### Core Components

- **Web App** (Next.js 16 + React 19) - Main user interface at port 3000
- **Dashboard** (Next.js + Playwright e2e tests) - Analytics and RAG dashboard at port 3001
- **AI Server** (NestJS) - Agent pipeline, OCR, summarization at port 4000
- **EdgeQuake** (Rust) - RAG engine with pgvector search at port 8080
- **ZeroClaw** (Rust) - Web crawler and agent runtime at port 8081
- **MCP Server** - Model Context Protocol server at port 8082
- **Relay Server** - Encrypted offline sync at port 3200
- **PostgreSQL** - Primary database with pgvector and Apache AGE extensions
- **Redis** - Cache layer
- **Ollama** - Local LLM inference at port 11434
- **SearxNG** - Meta-search engine at port 8888
- **IPFS Kubo** - Decentralized storage at ports 5001/8180
- **Desktop App** (Tauri) - Native desktop application
- **Mobile App** (Capacitor) - iOS/Android mobile application

---

## Prerequisites

### System Requirements

- macOS 10.15+ or Linux (Ubuntu 20.04+) or Windows 10+
- 8 GB RAM minimum (16 GB recommended for local Ollama models)
- 20 GB disk space minimum

### Required Software

**macOS (Homebrew)**
```bash
# Node.js (v20 or higher)
brew install node@20

# pnpm package manager (required for this monorepo)
brew install pnpm

# Docker Desktop (includes Docker and Docker Compose)
brew install --cask docker

# Rust (for EdgeQuake and ZeroClaw builds)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# PostgreSQL client tools (if running manually, not needed for Docker)
brew install postgresql

# Git
brew install git
```

**Linux (Ubuntu)**
```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm
npm install -g pnpm

# Docker
curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# PostgreSQL client
sudo apt-get install -y postgresql-client

# Git
sudo apt-get install -y git
```

**Windows (Chocolatey or WSL2)**
```bash
# Using Chocolatey
choco install nodejs-lts pnpm docker-desktop rustup git

# Or use WSL2 with Ubuntu and follow Linux instructions above
```

### Verify Installations

```bash
node --version        # Should be v20+
pnpm --version        # Should be v8+
docker --version      # Should be 24+
docker compose --version
cargo --version       # Rust toolchain
git --version
```

---

## Quick Start (Docker Compose)

The fastest way to get the entire stack running locally.

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/SayKnowMind.git
cd "SayKnowMind(Agentic Second Brain )"
```

### 2. Create Environment File

Copy the example environment file and customize it:

```bash
cp .env.example .env
```

Edit `.env` with required values:

```env
# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-secure-password-here

# Authentication - generate with: openssl rand -base64 32
BETTER_AUTH_SECRET=your-generated-secret

# Encryption key - generate with: openssl rand -hex 32
ENCRYPTION_KEY=your-generated-key

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000

# Relay Server secret - generate with: openssl rand -hex 32
RELAY_SHARED_SECRET=your-relay-secret

# API Keys (optional — use local Ollama by default)
OPENAI_API_KEY=
OPENROUTER_API_KEY=

# Deploy mode (auto|cloud|desktop)
NEXT_PUBLIC_DEPLOY_MODE=auto

# Telegram Bot (optional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
```

### 3. Generate Secure Secrets (One-Time)

```bash
# Generate BETTER_AUTH_SECRET (32 bytes base64)
openssl rand -base64 32

# Generate ENCRYPTION_KEY (32 bytes hex)
openssl rand -hex 32

# Generate RELAY_SHARED_SECRET (32 bytes hex)
openssl rand -hex 32

# Generate TELEGRAM_WEBHOOK_SECRET (32 bytes hex, if using Telegram)
openssl rand -hex 32
```

### 4. Start All Services

```bash
# Pull latest images and build custom services
docker compose pull
docker compose build

# Start all 13 services in the background
docker compose up -d

# View logs (all services)
docker compose logs -f

# View logs for specific service
docker compose logs -f web
docker compose logs -f edgequake
docker compose logs -f ai-server
```

### 5. Verify Services are Healthy

```bash
# Check service status
docker compose ps

# Test API endpoints
curl http://localhost:3000/api/health      # Web app
curl http://localhost:3001                 # Dashboard
curl http://localhost:4000/health          # AI Server
curl http://localhost:8080/health          # EdgeQuake
curl http://localhost:8082/health          # MCP Server
curl http://localhost:3200/health          # Relay Server

# Check database
docker compose exec postgres pg_isready -U postgres
```

### 6. Access the Application

- **Web App**: http://localhost:3000
- **Dashboard**: http://localhost:3001
- **AI Server API**: http://localhost:4000
- **EdgeQuake RAG**: http://localhost:8080
- **MCP Server**: http://localhost:8082
- **SearxNG**: http://localhost:8888
- **IPFS Gateway**: http://localhost:8180/ipfs

### 7. Shutdown Services

```bash
# Stop all services (preserve data)
docker compose down

# Stop and remove all data (clean slate)
docker compose down -v
```

---

## Manual Setup (Without Docker)

For development or custom configurations, you can run services individually.

### PostgreSQL Setup

PostgreSQL needs to be initialized with specific extensions (pgvector for vector search, Apache AGE for graph operations).

**Option A: Docker PostgreSQL Only**

```bash
docker run -d \
  --name sayknowmind-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=your-password \
  -e POSTGRES_DB=sayknowmind \
  -p 5432:5432 \
  -v postgres_data:/var/lib/postgresql/data \
  postgres:16-alpine

# Wait for startup
sleep 5

# Copy and run init scripts
docker exec -i sayknowmind-postgres psql -U postgres < db/init/03-init-extensions.sql
docker exec -i sayknowmind-postgres psql -U postgres < db/init/07-better-auth.sql
docker exec -i sayknowmind-postgres psql -U postgres < db/init/04-sayknowmind-init.sql
```

**Option B: Local PostgreSQL 16+ Installation**

macOS:
```bash
brew install postgresql@16
brew services start postgresql@16

# Connect to default database
psql -U postgres

# Inside psql:
CREATE DATABASE sayknowmind;
\c sayknowmind

-- Run init scripts
\i db/init/03-init-extensions.sql;
\i db/init/07-better-auth.sql;
\i db/init/04-sayknowmind-init.sql;
```

Linux (Ubuntu):
```bash
sudo apt-get install -y postgresql postgresql-contrib postgresql-16-pgvector

sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database
sudo -u postgres createdb sayknowmind
sudo -u postgres psql -d sayknowmind < db/init/03-init-extensions.sql
sudo -u postgres psql -d sayknowmind < db/init/07-better-auth.sql
sudo -u postgres psql -d sayknowmind < db/init/04-sayknowmind-init.sql
```

**Database Migrations**

After initialization, run all migration files in order:

```bash
# With Docker PostgreSQL
for f in db/migrations/*.sql; do
  echo "Running $f..."
  docker exec -i sayknowmind-postgres psql -U postgres -d sayknowmind < "$f"
done

# Or with local psql
cd db/migrations
for f in *.sql; do
  echo "Running $f..."
  psql -U postgres -d sayknowmind < "$f"
done
```

### Redis Setup

**Docker:**
```bash
docker run -d \
  --name sayknowmind-redis \
  -p 6379:6379 \
  redis:7-alpine

# Test connection
redis-cli ping
```

**Local Installation:**

macOS:
```bash
brew install redis
brew services start redis
redis-cli ping
```

Linux:
```bash
sudo apt-get install -y redis-server
sudo systemctl start redis-server
redis-cli ping
```

### Ollama (Local LLM)

**macOS/Linux:**
```bash
# Download and install from https://ollama.ai
curl https://ollama.ai/install.sh | sh

# Start Ollama service
ollama serve

# In another terminal, pull models
ollama pull nomic-embed-text         # Embeddings (small, ~274MB)
ollama pull Qwen/Qwen2.5-0.5b       # Fast text model
ollama pull llama2                   # Alternative model
```

**Docker:**
```bash
docker run -d \
  --name sayknowmind-ollama \
  -p 11434:11434 \
  -v ollama_data:/root/.ollama \
  -e OLLAMA_HOST=0.0.0.0:11434 \
  ollama/ollama:latest

# Pull models
docker exec sayknowmind-ollama ollama pull nomic-embed-text
docker exec sayknowmind-ollama ollama pull Qwen/Qwen2.5-0.5b
```

**Verify Ollama:**
```bash
curl http://localhost:11434/api/tags
curl -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model": "Qwen/Qwen2.5-0.5b", "prompt": "hello"}'
```

### EdgeQuake (Rust RAG Engine)

Prerequisites:
- Rust 1.80+ (installed via rustup)
- PostgreSQL running
- Ollama running

**Build and Run:**

```bash
cd packages/edgequake

# Build release binary
cargo build --release --locked

# Set environment variables
export DATABASE_URL="postgresql://postgres:password@localhost:5432/sayknowmind"
export RUST_LOG=info
export EDGEQUAKE_DEFAULT_LLM_PROVIDER=ollama
export EDGEQUAKE_DEFAULT_LLM_MODEL=Qwen/Qwen2.5-0.5b
export EDGEQUAKE_DEFAULT_EMBEDDING_PROVIDER=ollama
export EDGEQUAKE_DEFAULT_EMBEDDING_MODEL=nomic-embed-text
export OLLAMA_HOST=http://localhost:11434

# Run the server
./target/release/edgequake

# Verify health check
curl http://localhost:8080/health
```

### ZeroClaw (Rust Crawler)

```bash
cd packages/zeroclaw

# Build release binary
cargo build --release --locked

# Set environment variables
export RUST_LOG=info
export ZEROCLAW_PORT=8081

# Run the server
./target/release/zeroclaw

# Verify health check
curl http://localhost:8081/health
```

### AI Server (NestJS)

Prerequisites:
- Node.js 20+
- pnpm
- Redis running
- Ollama running

**Setup:**

```bash
cd apps/ai-server

# Install dependencies
pnpm install

# Set environment variables
export NODE_ENV=production
export PORT=4000
export REDIS_URL=redis://localhost:6379
export OLLAMA_URL=http://localhost:11434
export OCR_ENDPOINT=http://localhost:8000
export SEARXNG_URL=http://localhost:8888
export RATE_LIMIT_TTL=60
export RATE_LIMIT_MAX=100

# Build and run
pnpm run build
pnpm run start

# Or run in development
pnpm run dev
```

### Web App (Next.js)

Prerequisites:
- Node.js 20+
- pnpm
- PostgreSQL running
- All other services running

**Setup:**

```bash
cd apps/web

# Install dependencies
pnpm install

# Create .env.local (copy from .env)
cp .env.local.example .env.local

# Edit with your values
# DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY, etc.

# Build for production
pnpm run build

# Run production server
pnpm run start

# Or run in development
pnpm run dev
```

Access at http://localhost:3000

### Dashboard (Next.js)

```bash
cd apps/dashboard

pnpm install

cp .env.local.example .env.local

pnpm run build
pnpm run start
# Or: pnpm run dev
```

Access at http://localhost:3001

### MCP Server

```bash
cd packages/mcp-server

pnpm install

# Set environment variables
export EDGEQUAKE_URL=http://localhost:8080
export AUTH_SECRET=your-better-auth-secret

pnpm run build
pnpm run start
# Or: pnpm run dev
```

Access at http://localhost:8082

### Relay Server (Encrypted Sync)

```bash
cd packages/relay-server

pnpm install

# Set environment variables
export NODE_ENV=production
export PORT=3200
export RELAY_SHARED_SECRET=your-relay-secret
export DATABASE_URL=postgresql://postgres:password@localhost:5432/sayknowmind
export PURGE_INTERVAL_MS=900000

pnpm run build
pnpm run start
# Or: pnpm run dev
```

Access at http://localhost:3200

### SearxNG (Meta-Search)

**Docker:**
```bash
docker run -d \
  --name sayknowmind-searxng \
  -p 8888:8888 \
  -v ./docker/searxng/settings.yml:/etc/searxng/settings.yml:ro \
  searxng/searxng:latest
```

Access at http://localhost:8888

### IPFS Kubo

**Docker:**
```bash
docker run -d \
  --name sayknowmind-ipfs \
  -p 5001:5001 \
  -p 8180:8080 \
  -v ipfs_data:/data/ipfs \
  -e IPFS_PROFILE=server \
  ipfs/kubo:latest
```

**Verify:**
```bash
curl http://localhost:5001/api/v0/version
curl http://localhost:8180/ipfs/QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn
```

---

## Environment Variables

Complete reference for all configurable environment variables.

### Core Configuration

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `POSTGRES_USER` | Yes | PostgreSQL username | `postgres` |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password (change in production) | `changeme` |
| `DATABASE_URL` | Yes | Full PostgreSQL connection string | `postgresql://postgres:password@localhost:5432/sayknowmind` |
| `BETTER_AUTH_SECRET` | Yes | Session encryption secret (32 bytes base64) | Generate with `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | Yes | Per-user data encryption (32 bytes hex) | Generate with `openssl rand -hex 32` |

### Application URLs

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `BETTER_AUTH_URL` | Yes | Auth service URL | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | Yes | Frontend app URL | `http://localhost:3000` |
| `EDGEQUAKE_URL` | Yes | RAG engine URL | `http://localhost:8080` |
| `AI_SERVER_URL` | Yes | AI backend URL | `http://localhost:4000` |
| `RELAY_URL` | No | Sync relay URL | `http://localhost:3200` |
| `IPFS_KUBO_API` | No | IPFS API endpoint | `http://localhost:5001` |
| `IPFS_GATEWAY` | No | IPFS gateway URL | `http://localhost:8180/ipfs` |

### Service Ports

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB_PORT` | 3000 | Next.js web app |
| `DASHBOARD_PORT` | 3001 | Analytics dashboard |
| `AI_SERVER_PORT` | 4000 | NestJS AI server |
| `EDGEQUAKE_PORT` | 8080 | Rust RAG engine |
| `MCP_PORT` | 8082 | MCP server |
| `RELAY_PORT` | 3200 | Relay server |
| `OLLAMA_PORT` | 11434 | Ollama inference |
| `SEARXNG_PORT` | 8888 | Meta-search |

### LLM Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `ollama` | LLM backend: `ollama`, `openai`, `openrouter` |
| `LLM_MODEL` | `Qwen/Qwen2.5-0.5b` | LLM model name |
| `EMBEDDING_PROVIDER` | `ollama` | Embedding provider |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model |
| `OPENAI_API_KEY` | - | OpenAI API key (if using OpenAI) |
| `OPENROUTER_API_KEY` | - | OpenRouter API key (if using OpenRouter) |

### Deployment

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node.js environment |
| `NEXT_PUBLIC_DEPLOY_MODE` | `auto` | Deployment mode: `cloud`, `desktop`, `auto` |
| `RUST_LOG` | `info` | Rust logging level |

### Security

| Variable | Default | Description |
|----------|---------|-------------|
| `REQUIRE_EMAIL_VERIFICATION` | `false` | Require email verification |
| `TRUSTED_ORIGINS` | `http://localhost:3000` | CORS trusted origins |
| `PRIVATE_MODE` | `true` | Private mode (no sharing) |
| `RELAY_SHARED_SECRET` | - | Relay server encryption secret |

### Sync Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNCTHING_API` | - | Syncthing API URL |
| `SYNCTHING_API_KEY` | - | Syncthing API key |
| `TAILSCALE_API` | - | Tailscale API URL |

### Backup

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_DIR` | `./backups` | Backup directory |
| `BACKUP_RETENTION_DAYS` | 30 | Days to retain backups |
| `BACKUP_INTERVAL_MS` | 86400000 | Backup interval (ms) |

### Telegram Bot

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token |
| `TELEGRAM_WEBHOOK_SECRET` | No | Webhook secret (32 bytes hex) |

---

## Database Migrations

The database schema is managed through migrations in `db/migrations/`.

### Automatic Migrations (Docker)

Migrations run automatically when containers start (via database initialization scripts).

### Manual Migrations

If running manually:

```bash
# List all migration files
ls -1 db/migrations/ | sort

# Apply migrations in order
for f in db/migrations/*.sql; do
  echo "Applying $(basename $f)..."
  psql -U postgres -d sayknowmind < "$f"
done

# Or apply a specific migration
psql -U postgres -d sayknowmind < db/migrations/001_init_database.sql
```

### Current Schema

Key tables created by migrations:

- `"user"` - User accounts (better-auth)
- `session` - Active sessions (better-auth)
- `documents` - Ingested documents with metadata
- `document_chunks` - Vector chunks (pgvector)
- `conversations` - Chat history
- `categories` - Knowledge organization
- `tasks` - Ingestion job tracking
- `audit_logs` - System audit trail
- `shared_content` - Shared document access
- `notifications` - User notifications
- `channel_links` - Telegram integration
- `daily_usage_limits` - Rate limiting

### Resetting the Database

```bash
# Drop and recreate database
docker compose down -v
docker compose up -d postgres

# Wait for health check
sleep 10

# Re-initialize
docker compose up -d
```

---

## Desktop App (Tauri)

The native desktop application provides offline-first functionality.

### Prerequisites

- Node.js 20+ and pnpm
- Rust 1.80+ (for Tauri native compilation)
- macOS 10.15+ or Windows 10+ or Linux
- Xcode Command Line Tools (macOS)
- Visual Studio Build Tools (Windows)

### Build Desktop App

**macOS:**

```bash
cd apps/desktop

# Install dependencies
pnpm install

# Build Tauri app (creates .app bundle)
pnpm run tauri build

# Output: ./src-tauri/target/release/bundle/macos/SayknowMind.app

# Run in development mode (with hot reload)
pnpm run tauri dev
```

**Linux:**

```bash
# Install system dependencies
sudo apt-get install -y libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev

cd apps/desktop
pnpm install
pnpm run tauri build
```

**Windows:**

```bash
# Requires Visual Studio Build Tools (run as Administrator)
cd apps/desktop
pnpm install
pnpm run tauri build

# Output: .\src-tauri\target\release\bundle\msi\SayknowMind*.msi
```

### Configuration

Edit `apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "build": {
    "frontendDist": "https://mind.sayknow.ai",  // Production frontend
    "devUrl": "http://localhost:3000"             // Dev frontend
  },
  "app": {
    "windows": [
      {
        "title": "SayknowMind",
        "width": 1200,
        "height": 800,
        "minWidth": 400,
        "minHeight": 300
      }
    ]
  }
}
```

### Distribution

- **macOS**: Create `.dmg` installer from `.app` bundle
- **Windows**: `.msi` installer in `src-tauri/target/release/bundle/msi/`
- **Linux**: `.deb` package in `src-tauri/target/release/bundle/deb/`

---

## Mobile App (Capacitor)

The mobile app runs on iOS and Android with Capacitor bridge to web code.

### Prerequisites

- Node.js 20+ and pnpm
- iOS: Xcode 15+, macOS 12+, CocoaPods
- Android: Android Studio, SDK 33+, JDK 17+

### Setup iOS

```bash
cd apps/mobile

pnpm install

# Install Capacitor dependencies
pnpm exec cap add ios

# Open in Xcode
pnpm exec cap open ios

# In Xcode:
# 1. Select SayknowMind target
# 2. Set bundle identifier (com.sayknowmind.mobile)
# 3. Configure signing
# 4. Build and run
```

### Setup Android

```bash
cd apps/mobile

pnpm install

# Install Capacitor dependencies
pnpm exec cap add android

# Open in Android Studio
pnpm exec cap open android

# In Android Studio:
# 1. Sync Gradle
# 2. Select emulator or device
# 3. Run app
```

### Build Mobile App

```bash
# Build web assets
pnpm run build

# Sync to native platforms
pnpm exec cap sync

# iOS
pnpm exec cap open ios
# Then build in Xcode

# Android
pnpm exec cap open android
# Then build in Android Studio
```

---

## Deployment

### Railway.app Deployment

Railway is the recommended platform for SayKnowMind production deployment.

**Prerequisites:**
- Railway.app account
- GitHub repository connected

**Setup:**

1. Push code to GitHub
2. Connect repository to Railway
3. Add services:
   - PostgreSQL (Railway PostgreSQL plugin)
   - Redis (Railway Redis plugin)
   - Web (Next.js app)
   - AI Server (NestJS)
   - EdgeQuake (Rust)

**Environment Variables (in Railway):**

```env
POSTGRES_PASSWORD=<railway-postgres-password>
POSTGRES_USER=postgres
DATABASE_URL=<railway-postgres-url>
BETTER_AUTH_SECRET=<generated-secret>
ENCRYPTION_KEY=<generated-key>
BETTER_AUTH_URL=https://<railway-domain>.up.railway.app
NEXT_PUBLIC_APP_URL=https://<railway-domain>.up.railway.app
NEXT_PUBLIC_DEPLOY_MODE=cloud
LLM_PROVIDER=openai
OPENAI_API_KEY=<your-openai-key>
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
RELAY_SHARED_SECRET=<generated-secret>
```

**Deployment Steps:**

```bash
# Push to main branch
git push origin main

# Railway auto-deploys on push
# Monitor deployment at railway.app dashboard

# View logs
railway logs -f

# Scale services
railway scale web=2 ai-server=1
```

### Self-Hosted Docker Deployment

For VPS or on-premises deployment.

**Docker Swarm:**

```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.yml sayknowmind

# View services
docker service ls
docker service logs sayknowmind_web
```

**Kubernetes:**

Create `k8s/` manifests for:
- PostgreSQL StatefulSet
- Redis Deployment
- Web Deployment
- AI Server Deployment
- EdgeQuake Deployment

```bash
kubectl apply -f k8s/
kubectl get pods
kubectl logs -f deployment/sayknowmind-web
```

---

## Telegram Bot Setup

SayKnowMind includes optional Telegram bot integration for capturing notes and content.

### Prerequisites

- Telegram Bot Token (from BotFather)
- Public domain for webhook (or ngrok for local testing)

### Steps

1. **Create Telegram Bot**

   Chat with [@BotFather](https://t.me/botfather) on Telegram:
   - `/start`
   - `/newbot`
   - Follow prompts, receive API token

2. **Configure Environment**

   ```env
   TELEGRAM_BOT_TOKEN=123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh
   TELEGRAM_WEBHOOK_SECRET=<generated-32-byte-hex>
   ```

3. **Set Webhook URL**

   ```bash
   curl -X POST https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://yourdomain.com/api/integrations/telegram/webhook",
       "secret_token": "'$TELEGRAM_WEBHOOK_SECRET'"
     }'
   ```

4. **Local Testing (with ngrok)**

   ```bash
   # Start ngrok tunnel
   ngrok http 3000

   # Set webhook to ngrok URL
   curl -X POST https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://your-ngrok-url.ngrok.io/api/integrations/telegram/webhook",
       "secret_token": "'$TELEGRAM_WEBHOOK_SECRET'"
     }'
   ```

5. **Test Bot**

   Send a message to your bot on Telegram. It should appear in SayKnowMind.

---

## Troubleshooting

### Services Fail to Start

**Check logs:**
```bash
docker compose logs -f <service-name>
```

**Common issues:**

- **Port already in use**: Change port in `.env`
- **Database connection failed**: Verify PostgreSQL is running and password is correct
- **Ollama not found**: Pull models with `ollama pull <model>`

### Database Migrations Fail

```bash
# Check migration status
docker compose exec postgres pg_dump -U postgres sayknowmind | head -20

# Rerun specific migration
docker compose exec -i postgres psql -U postgres -d sayknowmind < db/migrations/001_init_database.sql
```

### LLM Errors

```bash
# Check Ollama status
curl http://localhost:11434/api/tags

# Pull missing model
docker compose exec ollama ollama pull nomic-embed-text

# Check logs
docker compose logs -f ollama
```

### Web App Blank Page

```bash
# Check web app logs
docker compose logs -f web

# Rebuild web app
docker compose down web
docker compose build --no-cache web
docker compose up -d web
```

### Authentication Issues

```bash
# Verify better-auth is configured
echo $BETTER_AUTH_SECRET

# Check session table
docker compose exec postgres psql -U postgres -d sayknowmind -c "SELECT * FROM session LIMIT 5;"
```

---

## Development Workflow

### Install Dependencies

```bash
cd "SayKnowMind(Agentic Second Brain )"

# Install all workspace dependencies
pnpm install
```

### Run All Services (Development)

```bash
# In separate terminals:

# Terminal 1: Start Docker services only (no web apps)
docker compose up postgres redis ollama edgequake ocr-server searxng ipfs mcp-server relay-server

# Terminal 2: Run web app
cd apps/web && pnpm run dev

# Terminal 3: Run AI Server
cd apps/ai-server && pnpm run dev

# Terminal 4: Run Dashboard
cd apps/dashboard && pnpm run dev
```

### Run Tests

```bash
# Web app tests
cd apps/web && pnpm test

# Dashboard tests
cd apps/dashboard && pnpm test

# AI Server tests
cd apps/ai-server && pnpm test

# Run all tests
pnpm run test --recursive
```

### Database Development

```bash
# Create migration
pnpm exec migrate create -n "migration_name"

# Apply migrations
pnpm exec migrate up

# Rollback
pnpm exec migrate down
```

---

## Production Checklist

Before deploying to production:

- [ ] Generate secure secrets (BETTER_AUTH_SECRET, ENCRYPTION_KEY, RELAY_SHARED_SECRET)
- [ ] Set strong PostgreSQL password
- [ ] Configure HTTPS/SSL certificates
- [ ] Set NEXT_PUBLIC_APP_URL to production domain
- [ ] Configure external LLM API (OpenAI, OpenRouter)
- [ ] Enable email verification (REQUIRE_EMAIL_VERIFICATION=true)
- [ ] Set up automated backups (BACKUP_INTERVAL_MS)
- [ ] Configure monitoring and logging
- [ ] Set up Telegram webhook with production domain
- [ ] Test all API endpoints
- [ ] Load test with production-like data
- [ ] Review OWASP security headers
- [ ] Enable rate limiting
- [ ] Document runbook for incident response

---

## Support

For issues or questions:

- Check logs: `docker compose logs -f <service>`
- Review error messages carefully
- Verify all environment variables are set
- Ensure all services are healthy: `docker compose ps`
- Check ports are not in use: `lsof -i :3000`
- Consult service documentation (Ollama, PostgreSQL, etc.)
