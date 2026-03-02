# 🚀 SayKnowAI AI Server - Quick Start Guide

## Step 1: Install Ollama (Required)

### macOS
```bash
# Install via Homebrew
brew install ollama

# Or use the official install script
curl -fsSL https://ollama.ai/install.sh | sh
```

### Linux
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

### Windows
Download from [https://ollama.ai/download](https://ollama.ai/download)

## Step 2: Download Qwen3 Model

```bash
# Start Ollama server
ollama serve

# In a new terminal, download the model (~5GB)
ollama pull qwen3:8b
```

## Step 3: Start AI Server

```bash
cd sayknowai-ai-server

# Install dependencies (if not already done)
npm install

# Generate RSA keys (if not already done)
npm run generate-keys

# Start in development mode
npm run start:dev
```

## Step 4: Test

### Terminal 1: AI server running

### Terminal 2: Run tests
```bash
# Health check
curl http://localhost:4000/health

# Chat test (development mode - no auth required)
curl -X POST http://localhost:4000/ai/chat/sync \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}]}'

# Or use the chat CLI
npm run chat
```

## Optional: SearXNG (Web Search)

```bash
# Run SearXNG with Docker
docker run -d --name searxng -p 8080:8080 searxng/searxng

# Test search
curl "http://localhost:8080/search?q=test&format=json"
```

## Troubleshooting

### Ollama Connection Failed
```bash
# Check Ollama status
ollama list

# Restart Ollama
pkill ollama
ollama serve
```

### Slow Model Loading
- The first run takes time to load the model (30s~1min)
- 8GB+ RAM recommended

### Port Conflict
```bash
# Check port usage
lsof -i :4000
lsof -i :11434

# Use a different port
PORT=4001 npm run start:dev
```

## Development Mode vs Production Mode

| Setting | Development | Production |
|---------|------------|------------|
| SKIP_AUTH | true | false |
| RSA Auth | Skipped | Required |
| Log Level | debug | info |

In production, make sure to set `SKIP_AUTH=false`!
