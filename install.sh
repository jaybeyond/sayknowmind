#!/usr/bin/env bash
# ============================================
# SayknowMind v0.1.0 - One-click Install Script
# ============================================
set -euo pipefail

BOLD='\033[1m'
CYAN='\033[36m'
GREEN='\033[32m'
RED='\033[31m'
YELLOW='\033[33m'
RESET='\033[0m'

echo -e "${CYAN}${BOLD}"
echo "  ____                  _                          __  __ _           _"
echo " / ___|  __ _ _   _| | ___ __   _____      _|  \/  (_)_ __   __| |"
echo " \___ \ / _\` | | | | |/ / '_ \ / _ \ \ /\ / / |\/| | | '_ \ / _\` |"
echo "  ___) | (_| | |_| |   <| | | | (_) \ V  V /| |  | | | | | | (_| |"
echo " |____/ \__,_|\__, |_|\_\_| |_|\___/ \_/\_/ |_|  |_|_|_| |_|\__,_|"
echo "              |___/"
echo -e "${RESET}"
echo -e "${BOLD}Open Personal Agentic Second Brain${RESET}"
echo "Everything you say, we know, and mind forever."
echo ""

# ---- Check prerequisites ----

check_command() {
  if ! command -v "$1" &> /dev/null; then
    echo -e "${RED}Error: $1 is not installed.${RESET}"
    echo "$2"
    exit 1
  fi
}

echo -e "${CYAN}Checking prerequisites...${RESET}"

check_command "docker" "Install Docker: https://docs.docker.com/get-docker/"
check_command "docker" "Install Docker Compose: https://docs.docker.com/compose/install/"

# Check Docker Compose (v2 plugin)
if docker compose version &> /dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
  COMPOSE_CMD="docker-compose"
else
  echo -e "${RED}Error: Docker Compose is not installed.${RESET}"
  echo "Install: https://docs.docker.com/compose/install/"
  exit 1
fi

echo -e "${GREEN}✓ Docker and Docker Compose found${RESET}"

# ---- Generate .env file ----

ENV_FILE=".env"

if [ -f "$ENV_FILE" ]; then
  echo -e "${YELLOW}Found existing .env file. Keeping current configuration.${RESET}"
else
  echo -e "${CYAN}Generating .env file...${RESET}"

  # Generate random secrets
  AUTH_SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
  ENCRYPTION_KEY=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')
  PG_PASSWORD=$(openssl rand -base64 16 2>/dev/null || head -c 16 /dev/urandom | base64)

  cat > "$ENV_FILE" << EOF
# ============================================
# SayknowMind v0.1.0 - Generated Configuration
# Generated on: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ============================================

# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=${PG_PASSWORD}
POSTGRES_PORT=5432

# Authentication
BETTER_AUTH_SECRET=${AUTH_SECRET}
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Database URL (uses 'postgres' container hostname for Docker networking)
DATABASE_URL=postgres://postgres:${PG_PASSWORD}@postgres:5432/sayknowmind

# Encryption
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# Service Ports
WEB_PORT=3000
DASHBOARD_PORT=3001
AI_SERVER_PORT=4000
EDGEQUAKE_PORT=8080
MCP_PORT=8082
OLLAMA_PORT=11434
SEARXNG_PORT=8888

# AI Provider (default: local Ollama)
LLM_PROVIDER=ollama
LLM_MODEL=Qwen/Qwen3.5-0.8B

# Mode
PRIVATE_MODE=true

# Logging
RUST_LOG=info
NODE_ENV=production
EOF

  echo -e "${GREEN}✓ .env file generated with random secrets${RESET}"
fi

# ---- Apply environment overrides ----

if [ -n "${SAYKNOWMIND_PORT:-}" ]; then
  sed -i.bak "s/WEB_PORT=.*/WEB_PORT=${SAYKNOWMIND_PORT}/" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
fi

# ---- Pull and start services ----

echo ""
echo -e "${CYAN}Starting SayknowMind services...${RESET}"
echo "This may take a few minutes on first run (downloading images)."
echo ""

$COMPOSE_CMD up -d

echo ""
echo -e "${GREEN}${BOLD}✓ SayknowMind is running!${RESET}"
echo ""
echo -e "  Web App:       ${BOLD}http://localhost:${WEB_PORT:-3000}${RESET}"
echo -e "  Dashboard:     ${BOLD}http://localhost:${DASHBOARD_PORT:-3001}${RESET}"
echo -e "  AI Server:     ${BOLD}http://localhost:${AI_SERVER_PORT:-4000}${RESET}"
echo -e "  EdgeQuake:     ${BOLD}http://localhost:${EDGEQUAKE_PORT:-8080}${RESET}"
echo ""
echo -e "${CYAN}Useful commands:${RESET}"
echo "  make status    - Check service status"
echo "  make logs      - View logs"
echo "  make down      - Stop all services"
echo ""
echo -e "${BOLD}Say it once. Know it forever.${RESET}"
