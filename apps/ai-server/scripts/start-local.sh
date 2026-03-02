#!/bin/bash
# SayKnowAI AI Server - Local Development Environment Start Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════╗"
echo "║       SayKnowAI AI Server - Local Environment Start    ║"
echo "╚════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# 1. Check RSA keys
echo -e "${YELLOW}[1/5] Checking RSA keys...${NC}"
if [ ! -f "$PROJECT_DIR/keys/private.pem" ]; then
    echo -e "${YELLOW}RSA keys not found. Generating...${NC}"
    cd "$PROJECT_DIR"
    node scripts/generate-keys.js
fi
echo -e "${GREEN}✅ RSA keys ready${NC}"

# 2. Check Ollama
echo -e "\n${YELLOW}[2/5] Checking Ollama...${NC}"
if ! command -v ollama &> /dev/null; then
    echo -e "${RED}❌ Ollama is not installed.${NC}"
    echo "Install: https://ollama.ai/download"
    exit 1
fi

if ! pgrep -x "ollama" > /dev/null; then
    echo -e "${YELLOW}Starting Ollama...${NC}"
    ollama serve &
    sleep 3
fi
echo -e "${GREEN}✅ Ollama running${NC}"

# 3. Check Qwen3 model
echo -e "\n${YELLOW}[3/5] Checking Qwen3 model...${NC}"
if ! ollama list | grep -q "qwen3"; then
    echo -e "${YELLOW}Downloading Qwen3 model... (~5GB, this may take a while)${NC}"
    ollama pull qwen3:8b
fi
echo -e "${GREEN}✅ Qwen3 model ready${NC}"

# 4. SearXNG (optional)
echo -e "\n${YELLOW}[4/5] Checking SearXNG (optional)...${NC}"
if command -v docker &> /dev/null; then
    if ! docker ps | grep -q "searxng"; then
        echo -e "${YELLOW}Starting SearXNG container...${NC}"
        docker run -d --name sayknowai-searxng -p 8080:8080 \
            -v "$PROJECT_DIR/searxng:/etc/searxng:rw" \
            searxng/searxng:latest 2>/dev/null || true
    fi
    echo -e "${GREEN}✅ SearXNG running (http://localhost:8080)${NC}"
else
    echo -e "${YELLOW}⚠️  Docker not found - Skipping SearXNG (web search disabled)${NC}"
fi

# 5. Start AI server
echo -e "\n${YELLOW}[5/5] Starting AI server...${NC}"
cd "$PROJECT_DIR"

# Check dependencies
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
fi

echo -e "${GREEN}"
echo "════════════════════════════════════════════════════════"
echo "  🚀 AI server starting!"
echo "════════════════════════════════════════════════════════"
echo -e "${NC}"
echo "  Server URL:    http://localhost:4000"
echo "  Health check:  http://localhost:4000/health"
echo "  Ollama:        http://localhost:11434"
echo "  SearXNG:       http://localhost:8080"
echo ""
echo "  Test:          npm run test:local"
echo "  Chat CLI:      npm run chat"
echo ""

# Start in development mode
npm run start:dev
