# SayKnowAI AI Server

Multimodal AI SDK - OpenRouter + Z.AI + Cloudflare Cascade Fallback + Intelligence System

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SayKnow AI SDK (sayknowai-ai-server)                 │
│                    Multimodal AI SDK - All-in-One Solution                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Core Services                               │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  🤖 AI Router        │  🔍 Search      │  📄 OCR        │  🧠 Memory│   │
│  │  - Cascade fallback   │  - SearXNG      │  - Image→Text  │  - Redis │   │
│  │  - Multi-model support│  - Web search   │  - PDF extract  │  - Session│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Intelligence System                              │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  📊 Tracer     │  📝 Spans      │  🔄 Adapter    │  🎯 Algorithm   │   │
│  │  - Auto tracing │  - Detailed log │  - Data convert │  - Learn/Opt  │   │
│  │                                                                     │   │
│  │  👍 Feedback   │  📈 Analytics  │  🏷️ Branding   │  ⚡ Optimizer   │   │
│  │  - Like/Dislike │  - Model perf  │  - Violation det│  - Prompt opt  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Storage (Redis)                             │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  spans:*  │  feedback:*  │  analytics:*  │  learning:*  │  memory:* │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 🤖 AI Model Cascade

### Pro Model (Quality-First)

**Korean/Japanese:**
```
Solar Pro 3 (OpenRouter) → Step 3.5 Flash → Qwen3 Next 80B → Z.AI GLM-4.7 → Vertex AI
```

**Other Languages:**
```
Step 3.5 Flash (OpenRouter) → Qwen3 Next 80B → Z.AI GLM-4.7 → Vertex AI
```

### Flash Model (Speed-First)
```
Step 3.5 Flash (OpenRouter) → Cloudflare Llama 3.1 70B → Qwen3 Next 80B → Vertex AI
```

### Free Models (OpenRouter)

| Model | Use Case | Features |
|-------|----------|----------|
| Solar Pro 3 | Pro (Korean) | Upstage, Korean specialized |
| Step 3.5 Flash | Pro/Flash | Fast and high quality |
| Qwen3 Next 80B | Pro/Flash | Large model, fallback |
| GLM 4.5 Air | Flash | Fast |
| Gemma 3 27B | Flash | Google lightweight model |

## 🔐 RSA Authentication Flow

```
Backend → AI Server:
  Headers:
  - X-Client-Id: sayknowai-backend
  - X-Timestamp: 1706123456789
  - X-Signature: base64(RSA-SHA256(timestamp.payload))

AI Server → Backend:
  - Response includes server signature
  - Timestamp validated within 5 minutes
```

## 🚀 Quick Start

### 1. Configure Environment Variables

```bash
cp .env.example .env
```

```env
# OpenRouter (Primary)
OPENROUTER_API_KEY=your-key
USE_OPENROUTER=true

# Z.AI (Fallback)
ZAI_API_KEY=your-key
USE_ZAI=true

# Cloudflare Workers AI (Fallback)
CLOUDFLARE_ACCOUNT_ID=your-id
CLOUDFLARE_API_TOKEN=your-token
USE_CLOUDFLARE=true

# Redis (Memory/Intelligence)
REDIS_URL=redis://localhost:6379

# External Services
OCR_ENDPOINT=http://localhost:8000
SEARXNG_URL=http://localhost:8080
```

### 2. Run

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## 📡 API Endpoints

### AI Chat

```typescript
// POST /ai/chat (streaming)
{
  message: "Hello!",
  userId: "user_xxx",
  sessionId: "session_xxx",
  aiModel: "pro" | "flash",
  systemPrompt?: string,
  enableSearch?: boolean,
  enableThinking?: boolean,
  userContext?: { time, location }
}

// Response (SSE)
data: {"content": "Hello"}
data: {"content": " there!"}
data: {"done": true, "model": "openrouter:upstage/solar-pro-3:free"}
```

### Intelligence Analytics

```typescript
// GET /intelligence/analytics/dashboard
{
  totalCalls: 1234,
  successRate: 0.95,
  avgLatency: 2500,
  modelUsage: { "solar-pro-3": 500, "step-3.5-flash": 300 },
  feedbackStats: { positive: 100, negative: 10 }
}

// GET /intelligence/analytics/models
// GET /intelligence/analytics/cost
```

### Feedback

```typescript
// POST /intelligence/feedback
{
  messageId: "msg_xxx",
  isGood: true,
  comment?: "Great answer",
  userId: "user_xxx"
}
```

### Health Check

```typescript
// GET /health
{
  status: "healthy",
  services: {
    redis: "up",
    openrouter: "up",
    zai: "up",
    ocr: "up",
    searxng: "up"
  }
}
```

## 🧠 Memory System

> ⚠️ **Important**: If `REDIS_URL` is not configured, the memory system is disabled and **every conversation starts fresh**!

### Redis Setup (Required)

```bash
# Add Redis service on Railway for auto-connection
# Or use an external Redis service:

# Upstash (free) - https://upstash.com
REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379

# Redis Cloud (free tier) - https://redis.com/try-free/
REDIS_URL=redis://default:xxx@xxx.redis.cloud:6379
```

### Session Context
- Maintains last 6 messages
- Auto-generates conversation summaries
- Extracts topics/key points

### User Memory
- Learns name, occupation, interests
- Semantic-based search (Semantic Memory)

### Branding Rules
- Auto-filters AI model names
- Persona mode support
- Identity question detection

## ⚡ Performance Optimization

- Parallelized Redis lookups (Promise.all)
- Eliminated duplicate API calls
- Async memory updates
- Model name filtering on response save

## 🚂 Railway Deployment

Environment variables:
```
PORT=4000
NODE_ENV=production
OPENROUTER_API_KEY=xxx
ZAI_API_KEY=xxx
CLOUDFLARE_ACCOUNT_ID=xxx
CLOUDFLARE_API_TOKEN=xxx
REDIS_URL=redis://xxx
PRIVATE_KEY=xxx (RSA)
PUBLIC_KEY=xxx (RSA)
```

## 📊 Resource Requirements

| Service | RAM | CPU | Notes |
|---------|-----|-----|-------|
| AI Server | 512MB | 0.5 | NestJS |
| OCR Server | 2GB | 1 | PaddleOCR |
| SearXNG | 256MB | 0.25 | Search proxy |
| Redis | 256MB | 0.25 | Memory/Cache |
| **Total** | **~3GB** | **2** | |

## 🔒 Security

- RSA keys managed via environment variables
- Timestamp validation (replay prevention)
- Auto-filtering of sensitive info (API keys, emails, etc.)
- GDPR compliant (user data deletion API)

## 📝 License

MIT License
