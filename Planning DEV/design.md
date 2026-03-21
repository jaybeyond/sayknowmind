# SayknowMind v0.1.0 설계 문서

## 개요

SayknowMind는 오픈소스(MIT) 개인 에이전틱 세컨드 브레인 플랫폼으로, "Everything you say, we know, and mind forever." 슬로건 아래 사용자가 수집한 모든 지식을 로컬 우선(Private Mode)으로 저장·검색·활용할 수 있는 풀스택 크로스 플랫폼 시스템이다.

### 핵심 설계 원칙

1. **로컬 우선 (Local-First)**: Private Mode에서 모든 데이터를 100% 로컬에 저장하며 외부 네트워크 접근을 차단
2. **GraphRAG 기반**: Apache AGE(그래프 DB) + pgvector(벡터 DB)를 결합한 하이브리드 검색
3. **멀티 에이전트 오케스트레이션**: LangGraph를 통한 Stateful 워크플로우 관리
4. **크로스 플랫폼**: 웹, 데스크톱(Tauri), 모바일(Capacitor), MCP Server 지원
5. **선택적 분산 공유**: Lit Protocol v3 + IPFS + Arweave를 통한 암호화 공유

### 시스템 목표

- 10만 개 이상의 Document 저장 및 200ms 이내 검색 응답
- 99.9% 이상의 가용성
- OWASP Top 10 보안 취약점 방어
- 다국어 지원 (한국어, 영어, 일본어, 중국어)

## 아키텍처

### 시스템 아키텍처 다이어그램

```mermaid
graph TB
    subgraph "클라이언트 계층"
        WebUI[웹 UI<br/>Next.js 16 + React 19]
        DesktopApp[데스크톱 앱<br/>Tauri]
        MobileApp[모바일 앱<br/>Capacitor]
        BrowserExt[브라우저 확장]
        MCPClient[MCP 클라이언트<br/>Claude/ChatGPT/Cursor]
    end

    subgraph "API 게이트웨이 계층"
        APIGateway[API 게이트웨이<br/>Next.js API Routes]
        MCPServer[MCP Server<br/>Model Context Protocol]
        Auth[인증 모듈<br/>better-auth]
        AntiBot[봇 차단 모듈]
    end

    subgraph "애플리케이션 계층"
        Frontend[프론트엔드 서비스<br/>Vercel AI SDK]
        IngestionPipeline[Ingestion Pipeline<br/>crawl4ai + vakra-dev/reader]
        CategoryManager[카테고리 관리자<br/>트리 + 그래프 UI]
        AgentOrchestrator[Agent 오케스트레이터<br/>LangGraph]
    end

    subgraph "AI 계층"
        AIServer[sayknow-ai-server<br/>포트 4000]
        LightweightModels[경량 모델<br/>Qwen2.5-0.5B, Phi-3.5-mini]
        HighPerfModels[고성능 모델<br/>Qwen3.5-3B, Step 3.5 Flash]
        Cascade[Cascade Fallback<br/>WebLLM → Ollama → OpenRouter]
    end

    subgraph "데이터 계층"
        EdgeQuake[EdgeQuake Engine<br/>Rust v0.5.1]
        PostgreSQL[(PostgreSQL<br/>+ pgvector)]
        ApacheAGE[(Apache AGE<br/>그래프 DB)]
        ZeroClaw[ZeroClaw Runtime<br/>Rust v0.1.7]
    end

    subgraph "분산 저장 계층 (Shared Mode)"
        LitProtocol[Lit Protocol v3<br/>접근 제어]
        IPFS[IPFS<br/>분산 저장]
        Arweave[Arweave<br/>영구 저장]
        Ceramic[Ceramic Network<br/>메타데이터]
    end

    subgraph "로컬 동기화 (Private Mode)"
        Tailscale[Tailscale<br/>보안 네트워크]
        Syncthing[Syncthing<br/>데이터 동기화]
    end

    WebUI --> APIGateway
    DesktopApp --> APIGateway
    MobileApp --> APIGateway
    BrowserExt --> IngestionPipeline
    MCPClient --> MCPServer

    APIGateway --> Auth
    APIGateway --> AntiBot
    APIGateway --> Frontend
    MCPServer --> Auth

    Frontend --> IngestionPipeline
    Frontend --> CategoryManager
    Frontend --> AgentOrchestrator
    Frontend --> EdgeQuake

    IngestionPipeline --> AIServer
    CategoryManager --> AIServer
    AgentOrchestrator --> ZeroClaw

    AIServer --> LightweightModels
    AIServer --> HighPerfModels
    AIServer --> Cascade

    EdgeQuake --> PostgreSQL
    EdgeQuake --> ApacheAGE
    ZeroClaw --> AgentOrchestrator

    Frontend -.->|Shared Mode| LitProtocol
    LitProtocol --> IPFS
    LitProtocol --> Arweave
    LitProtocol --> Ceramic

    DesktopApp -.->|Private Mode| Tailscale
    MobileApp -.->|Private Mode| Tailscale
    Tailscale --> Syncthing
```


### 배포 아키텍처

```mermaid
graph TB
    subgraph "Docker Compose 환경"
        subgraph "프론트엔드 컨테이너"
            NextJS[Next.js 16 서버<br/>포트 3000]
        end

        subgraph "AI 서버 컨테이너"
            AIServer[sayknow-ai-server<br/>포트 4000]
        end

        subgraph "데이터베이스 컨테이너"
            PG[(PostgreSQL 16<br/>+ pgvector + Apache AGE<br/>포트 5432)]
        end

        subgraph "EdgeQuake 컨테이너"
            EQ[EdgeQuake Engine<br/>Rust 서비스<br/>포트 8080]
        end

        subgraph "ZeroClaw 컨테이너"
            ZC[ZeroClaw Runtime<br/>Rust 서비스<br/>포트 8081]
        end

        subgraph "MCP 서버 컨테이너"
            MCP[MCP Server<br/>포트 8082]
        end
    end

    subgraph "Docker Volumes"
        DBVolume[(db_data)]
        UserVolume[(user_data)]
        ModelVolume[(model_cache)]
    end

    NextJS --> EQ
    NextJS --> AIServer
    NextJS --> MCP
    EQ --> PG
    ZC --> PG
    AIServer --> ModelVolume
    PG --> DBVolume
    EQ --> UserVolume

    style NextJS fill:#00E5FF
    style AIServer fill:#FF2E63
    style PG fill:#0A0A0A
    style EQ fill:#00E5FF
    style ZC fill:#FF2E63
```

### 컴포넌트 설명

#### 클라이언트 계층

1. **웹 UI (Next.js 16 + React 19)**
   - square-ui/bookmarks 템플릿 기반 레이아웃
   - shadcn/ui + Tailwind CSS 컴포넌트
   - Vercel AI SDK 통합
   - 브랜딩 컬러: Primary #00E5FF, Accent #FF2E63, Background #0A0A0A
   - 타이포그래피: Inter, Space Grotesk, Satoshi

2. **데스크톱 앱 (Tauri)**
   - Windows, macOS, Linux 지원
   - 시스템 트레이 통합
   - 글로벌 단축키 지원
   - 자동 업데이트 기능

3. **모바일 앱 (Capacitor)**
   - Android, iOS 지원
   - 공유 인텐트 수신
   - 오프라인 모드
   - 푸시 알림

4. **브라우저 확장**
   - 웹 페이지 원클릭 저장
   - 컨텍스트 메뉴 통합

5. **MCP 클라이언트**
   - Claude Desktop, ChatGPT Plugin, Cursor, Windsurf 연동


#### API 게이트웨이 계층

1. **API 게이트웨이 (Next.js API Routes)**
   - RESTful API 엔드포인트
   - 요청 라우팅 및 로드 밸런싱
   - 속도 제한 (Rate Limiting)
   - CORS 정책 관리

2. **MCP Server**
   - Model Context Protocol 표준 준수
   - 외부 AI 플랫폼 연동
   - 토큰 기반 인증
   - 자동 재연결 (최대 3회)

3. **인증 모듈 (better-auth)**
   - 이메일/비밀번호 인증
   - 세션 토큰 관리
   - 5회 실패 시 15분 계정 잠금
   - JWT 기반 토큰 발급

4. **봇 차단 모듈**
   - 봇 트래픽 패턴 분석
   - 1% 미만 오탐률 목표
   - 차단 로그 기록

#### 애플리케이션 계층

1. **프론트엔드 서비스**
   - Vercel AI SDK를 통한 스트리밍 응답
   - React 19 Suspense 기반 비동기 렌더링
   - Sigma.js 그래프 시각화
   - React Flow 카테고리 그래프

2. **Ingestion Pipeline**
   - **crawl4ai**: 웹 페이지 크롤링
   - **vakra-dev/reader**: 콘텐츠 추출
   - **Scrapling**: 구조화된 데이터 추출
   - **tf-playwright-stealth**: JavaScript 렌더링
   - 자동 요약 생성
   - Entity 자동 추출
   - 동적 카테고리 할당

3. **카테고리 관리자**
   - 트리 구조 UI (계층 표시)
   - React Flow 그래프 UI (관계 시각화)
   - 드래그 앤 드롭 이동
   - Agent 기반 자동 제안
   - 카테고리 병합 기능

4. **Agent 오케스트레이터 (LangGraph)**
   - Stateful 멀티 에이전트 워크플로우
   - 작업 분해 및 할당
   - Agent 간 메시지 전달
   - 상태 공유 관리
   - 실행 이력 로깅

#### AI 계층

1. **sayknow-ai-server (포트 4000)**
   - 모든 AI 추론 중앙 집중화
   - 경량 모델: Qwen2.5-0.5B, Phi-3.5-mini (요약/추출)
   - 고성능 모델: Qwen3.5-3B, Step 3.5 Flash (Agentic Query)
   - Cascade Fallback: WebLLM → Ollama → OpenRouter → Z.AI → Cloudflare
   - 모델 캐싱 및 로드 밸런싱

#### 데이터 계층

1. **EdgeQuake Engine (Rust v0.5.1)**
   - 6가지 Query Mode:
     - **Local**: 로컬 벡터 검색
     - **Global**: 글로벌 그래프 검색
     - **Hybrid**: 벡터 + 그래프 결합
     - **Drift**: 시간 기반 검색
     - **Mix**: 다중 모드 조합
     - **Naive**: 키워드 검색
   - 200ms 이내 응답 목표
   - Citation 자동 생성

2. **PostgreSQL + pgvector + Apache AGE**
   - PostgreSQL 16 기반
   - pgvector: 벡터 임베딩 저장 및 검색
   - Apache AGE: 그래프 데이터 저장 및 쿼리
   - 10만 개 이상 Document 지원

3. **ZeroClaw Runtime (Rust v0.1.7)**
   - 안전성 검증된 기능만 사용
   - Agent 리소스 모니터링 (CPU, 메모리)
   - 안전한 Agent 종료
   - 오류 상태 보고


#### 분산 저장 계층 (Shared Mode)

1. **Lit Protocol v3**
   - 콘텐츠 접근 제어
   - 조건부 암호화 (지갑 주소, 토큰 보유)
   - 권한 철회 (Revoke) 기능

2. **IPFS**
   - 분산 콘텐츠 저장
   - Content-Addressed Storage
   - 피어 투 피어 전송

3. **Arweave**
   - 영구 저장 (Permanent Storage)
   - 한 번 지불, 영구 보관

4. **Ceramic Network**
   - 공유 메타데이터 관리
   - 분산 ID (DID) 통합

#### 로컬 동기화 (Private Mode)

1. **Tailscale**
   - 디바이스 간 보안 네트워크
   - WireGuard 기반 VPN
   - 무료 오픈소스

2. **Syncthing**
   - 디바이스 간 데이터 동기화
   - 충돌 감지 및 수동 해결
   - P2P 동기화

## 컴포넌트 및 인터페이스

### 주요 컴포넌트 상호작용

```mermaid
sequenceDiagram
    participant User
    participant WebUI
    participant APIGateway
    participant Auth
    participant IngestionPipeline
    participant AIServer
    participant EdgeQuake
    participant PostgreSQL

    User->>WebUI: URL 붙여넣기
    WebUI->>APIGateway: POST /api/ingest
    APIGateway->>Auth: 토큰 검증
    Auth-->>APIGateway: 인증 성공
    APIGateway->>IngestionPipeline: 수집 요청
    IngestionPipeline->>IngestionPipeline: crawl4ai로 크롤링
    IngestionPipeline->>IngestionPipeline: vakra-dev/reader로 추출
    IngestionPipeline->>AIServer: 요약 생성 요청
    AIServer-->>IngestionPipeline: 요약 텍스트
    IngestionPipeline->>AIServer: Entity 추출 요청
    AIServer-->>IngestionPipeline: Entity 목록
    IngestionPipeline->>EdgeQuake: Document 저장
    EdgeQuake->>PostgreSQL: 벡터 + 그래프 저장
    PostgreSQL-->>EdgeQuake: 저장 완료
    EdgeQuake-->>IngestionPipeline: Document ID
    IngestionPipeline-->>APIGateway: 수집 완료
    APIGateway-->>WebUI: 성공 응답
    WebUI-->>User: 알림 표시
```

### 검색 및 채팅 플로우

```mermaid
sequenceDiagram
    participant User
    participant WebUI
    participant APIGateway
    participant EdgeQuake
    participant AIServer
    participant LangGraph
    participant ZeroClaw

    User->>WebUI: 자연어 질문 입력
    WebUI->>APIGateway: POST /api/search
    APIGateway->>EdgeQuake: 검색 쿼리 (Hybrid Mode)
    EdgeQuake->>EdgeQuake: 벡터 + 그래프 검색
    EdgeQuake-->>APIGateway: 검색 결과 + Citation
    
    alt Agentic Query 필요
        APIGateway->>LangGraph: 복잡한 질의 분해
        LangGraph->>ZeroClaw: Agent 실행
        ZeroClaw->>AIServer: 추론 요청
        AIServer-->>ZeroClaw: 추론 결과
        ZeroClaw-->>LangGraph: Agent 결과
        LangGraph->>LangGraph: 결과 통합
        LangGraph-->>APIGateway: 최종 답변
    else 단순 검색
        APIGateway->>AIServer: 답변 생성 요청
        AIServer-->>APIGateway: 답변 텍스트 (스트리밍)
    end
    
    APIGateway-->>WebUI: 스트리밍 응답
    WebUI-->>User: 실시간 답변 표시
```


### API 인터페이스 설계

#### 내부 API (Next.js API Routes)

**인증 API**

```typescript
// POST /api/auth/signup
interface SignupRequest {
  email: string;
  password: string;
  name?: string;
}

interface SignupResponse {
  userId: string;
  token: string;
  expiresAt: string;
}

// POST /api/auth/login
interface LoginRequest {
  email: string;
  password: string;
}

interface LoginResponse {
  userId: string;
  token: string;
  expiresAt: string;
}

// POST /api/auth/logout
interface LogoutRequest {
  token: string;
}

interface LogoutResponse {
  success: boolean;
}
```

**Ingestion API**

```typescript
// POST /api/ingest/url
interface IngestUrlRequest {
  url: string;
  categoryId?: string;
  tags?: string[];
}

interface IngestUrlResponse {
  documentId: string;
  title: string;
  summary: string;
  entities: Entity[];
  suggestedCategories: CategorySuggestion[];
}

// POST /api/ingest/file
interface IngestFileRequest {
  file: File; // multipart/form-data
  categoryId?: string;
  tags?: string[];
}

interface IngestFileResponse {
  documentId: string;
  title: string;
  summary: string;
  entities: Entity[];
  suggestedCategories: CategorySuggestion[];
}

// GET /api/ingest/status/:jobId
interface IngestStatusResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number; // 0-100
  error?: string;
}
```

**검색 API**

```typescript
// POST /api/search
interface SearchRequest {
  query: string;
  mode: 'local' | 'global' | 'hybrid' | 'drift' | 'mix' | 'naive';
  limit?: number;
  offset?: number;
  filters?: {
    categoryIds?: string[];
    dateRange?: { start: string; end: string };
    tags?: string[];
  };
}

interface SearchResponse {
  results: SearchResult[];
  totalCount: number;
  took: number; // milliseconds
}

interface SearchResult {
  documentId: string;
  title: string;
  snippet: string;
  score: number;
  citations: Citation[];
  entities: Entity[];
}

interface Citation {
  documentId: string;
  title: string;
  url?: string;
  excerpt: string;
  relevanceScore: number;
}
```

**채팅 API**

```typescript
// POST /api/chat
interface ChatRequest {
  message: string;
  conversationId?: string;
  mode: 'simple' | 'agentic';
  context?: {
    documentIds?: string[];
    categoryIds?: string[];
  };
}

interface ChatResponse {
  conversationId: string;
  messageId: string;
  answer: string; // 스트리밍 시 Server-Sent Events
  citations: Citation[];
  relatedDocuments: string[];
  agentSteps?: AgentStep[]; // agentic mode only
}

interface AgentStep {
  stepId: string;
  agentName: string;
  action: string;
  result: string;
  timestamp: string;
}
```

**카테고리 API**

```typescript
// GET /api/categories
interface GetCategoriesResponse {
  categories: Category[];
  tree: CategoryTree;
  graph: CategoryGraph;
}

// POST /api/categories
interface CreateCategoryRequest {
  name: string;
  parentId?: string;
  description?: string;
  color?: string;
}

interface CreateCategoryResponse {
  categoryId: string;
  name: string;
  path: string[]; // 계층 경로
}

// PUT /api/categories/:id
interface UpdateCategoryRequest {
  name?: string;
  parentId?: string;
  description?: string;
  color?: string;
}

// DELETE /api/categories/:id
interface DeleteCategoryResponse {
  success: boolean;
  movedDocuments: number; // 이동된 문서 수
}

// POST /api/categories/merge
interface MergeCategoriesRequest {
  sourceIds: string[];
  targetId: string;
}

interface MergeCategoriesResponse {
  success: boolean;
  mergedCount: number;
}
```


#### MCP Server API

```typescript
// MCP Protocol 표준 준수
interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

// MCP 메서드: sayknowmind.search
interface MCPSearchParams {
  query: string;
  mode?: string;
  limit?: number;
}

interface MCPSearchResult {
  documents: Array<{
    id: string;
    title: string;
    content: string;
    url?: string;
    relevance: number;
  }>;
}

// MCP 메서드: sayknowmind.ingest
interface MCPIngestParams {
  url?: string;
  content?: string;
  title?: string;
}

interface MCPIngestResult {
  documentId: string;
  status: 'success' | 'failed';
  message?: string;
}

// MCP 메서드: sayknowmind.categories
interface MCPCategoriesResult {
  categories: Array<{
    id: string;
    name: string;
    path: string[];
  }>;
}
```

#### SDK 인터페이스

**Python SDK**

```python
from sayknowmind import SayknowMindClient

# 클라이언트 초기화
client = SayknowMindClient(
    api_key="your_api_key",
    base_url="http://localhost:3000"
)

# Document 수집
result = client.ingest_url(
    url="https://example.com",
    category_id="cat_123",
    tags=["tech", "ai"]
)

# 검색
results = client.search(
    query="GraphRAG 설명",
    mode="hybrid",
    limit=10
)

# 채팅
response = client.chat(
    message="EdgeQuake가 뭐야?",
    mode="agentic"
)

# 카테고리 관리
categories = client.get_categories()
new_category = client.create_category(
    name="AI Research",
    parent_id="cat_root"
)
```

**TypeScript SDK**

```typescript
import { SayknowMindClient } from '@sayknowmind/sdk';

// 클라이언트 초기화
const client = new SayknowMindClient({
  apiKey: 'your_api_key',
  baseUrl: 'http://localhost:3000'
});

// Document 수집
const result = await client.ingestUrl({
  url: 'https://example.com',
  categoryId: 'cat_123',
  tags: ['tech', 'ai']
});

// 검색
const results = await client.search({
  query: 'GraphRAG 설명',
  mode: 'hybrid',
  limit: 10
});

// 채팅 (스트리밍)
const stream = await client.chatStream({
  message: 'EdgeQuake가 뭐야?',
  mode: 'agentic'
});

for await (const chunk of stream) {
  console.log(chunk.answer);
}

// 카테고리 관리
const categories = await client.getCategories();
const newCategory = await client.createCategory({
  name: 'AI Research',
  parentId: 'cat_root'
});
```

**Go SDK**

```go
package main

import (
    "github.com/sayknowmind/go-sdk"
)

func main() {
    // 클라이언트 초기화
    client := sayknowmind.NewClient(
        sayknowmind.WithAPIKey("your_api_key"),
        sayknowmind.WithBaseURL("http://localhost:3000"),
    )

    // Document 수집
    result, err := client.IngestURL(context.Background(), &sayknowmind.IngestURLRequest{
        URL:        "https://example.com",
        CategoryID: "cat_123",
        Tags:       []string{"tech", "ai"},
    })

    // 검색
    results, err := client.Search(context.Background(), &sayknowmind.SearchRequest{
        Query: "GraphRAG 설명",
        Mode:  sayknowmind.ModeHybrid,
        Limit: 10,
    })

    // 채팅
    response, err := client.Chat(context.Background(), &sayknowmind.ChatRequest{
        Message: "EdgeQuake가 뭐야?",
        Mode:    sayknowmind.ModeAgentic,
    })

    // 카테고리 관리
    categories, err := client.GetCategories(context.Background())
    newCategory, err := client.CreateCategory(context.Background(), &sayknowmind.CreateCategoryRequest{
        Name:     "AI Research",
        ParentID: "cat_root",
    })
}
```


## 데이터 모델

### 핵심 엔티티

```mermaid
erDiagram
    User ||--o{ Document : owns
    User ||--o{ Category : creates
    User ||--o{ Conversation : has
    Document ||--o{ Entity : contains
    Document }o--o{ Category : belongs_to
    Document ||--o{ Citation : referenced_by
    Document ||--o{ Vector : has
    Document ||--o{ GraphNode : represents
    Category ||--o{ Category : parent_of
    Category }o--o{ Category : related_to
    Conversation ||--o{ Message : contains
    Message }o--o{ Document : references
    Entity }o--o{ Entity : related_to
    GraphNode }o--o{ GraphNode : connected_to

    User {
        string id PK
        string email UK
        string password_hash
        string name
        timestamp created_at
        timestamp last_login
        int failed_login_count
        timestamp locked_until
    }

    Document {
        string id PK
        string user_id FK
        string title
        text content
        text summary
        string url
        string source_type
        jsonb metadata
        timestamp created_at
        timestamp updated_at
        timestamp indexed_at
    }

    Entity {
        string id PK
        string document_id FK
        string name
        string type
        float confidence
        jsonb properties
        timestamp extracted_at
    }

    Category {
        string id PK
        string user_id FK
        string parent_id FK
        string name
        text description
        string color
        int depth
        string path
        timestamp created_at
        timestamp updated_at
    }

    Vector {
        string id PK
        string document_id FK
        vector embedding
        string model_name
        int dimension
        timestamp created_at
    }

    GraphNode {
        string id PK
        string document_id FK
        string entity_id FK
        string node_type
        jsonb properties
        timestamp created_at
    }

    GraphEdge {
        string id PK
        string source_node_id FK
        string target_node_id FK
        string edge_type
        float weight
        jsonb properties
        timestamp created_at
    }

    Conversation {
        string id PK
        string user_id FK
        string title
        timestamp created_at
        timestamp updated_at
    }

    Message {
        string id PK
        string conversation_id FK
        string role
        text content
        jsonb citations
        jsonb agent_steps
        timestamp created_at
    }

    Citation {
        string id PK
        string document_id FK
        string message_id FK
        text excerpt
        float relevance_score
        int position
    }

    SharedContent {
        string id PK
        string document_id FK
        string user_id FK
        string ipfs_cid
        string arweave_tx_id
        string ceramic_stream_id
        jsonb access_conditions
        boolean is_revoked
        timestamp created_at
        timestamp revoked_at
    }
```

### 데이터 모델 상세

**User (사용자)**

```typescript
interface User {
  id: string; // UUID
  email: string; // 고유 이메일
  passwordHash: string; // bcrypt 해시
  name?: string;
  createdAt: Date;
  lastLogin?: Date;
  failedLoginCount: number; // 연속 실패 횟수
  lockedUntil?: Date; // 계정 잠금 해제 시간
  settings: {
    language: 'ko' | 'en' | 'ja' | 'zh';
    theme: 'light' | 'dark' | 'auto';
    defaultQueryMode: QueryMode;
  };
}
```

**Document (문서)**

```typescript
interface Document {
  id: string; // UUID
  userId: string; // FK to User
  title: string;
  content: string; // 전체 텍스트
  summary: string; // AI 생성 요약
  url?: string; // 원본 URL
  sourceType: 'web' | 'file' | 'text' | 'browser_extension';
  metadata: {
    author?: string;
    publishedAt?: Date;
    language?: string;
    wordCount: number;
    fileType?: string;
    fileSize?: number;
  };
  createdAt: Date;
  updatedAt: Date;
  indexedAt?: Date; // 벡터 인덱싱 완료 시간
}
```

**Entity (개체)**

```typescript
interface Entity {
  id: string; // UUID
  documentId: string; // FK to Document
  name: string; // 개체 이름
  type: 'person' | 'organization' | 'location' | 'concept' | 'keyword' | 'date' | 'other';
  confidence: number; // 0.0 ~ 1.0
  properties: {
    aliases?: string[]; // 별칭
    description?: string;
    wikidata_id?: string;
    [key: string]: any;
  };
  extractedAt: Date;
}
```

**Category (카테고리)**

```typescript
interface Category {
  id: string; // UUID
  userId: string; // FK to User
  parentId?: string; // FK to Category (self-reference)
  name: string;
  description?: string;
  color?: string; // HEX 컬러 코드
  depth: number; // 트리 깊이 (0 = root)
  path: string; // 계층 경로 (예: "/root/tech/ai")
  createdAt: Date;
  updatedAt: Date;
}

interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  reason: string; // 제안 사유
  confidence: number; // 0.0 ~ 1.0
}
```


**Vector (벡터 임베딩)**

```typescript
interface Vector {
  id: string; // UUID
  documentId: string; // FK to Document
  embedding: number[]; // 벡터 임베딩 (pgvector)
  modelName: string; // 사용된 모델 (예: "text-embedding-3-small")
  dimension: number; // 벡터 차원 (예: 1536)
  createdAt: Date;
}
```

**GraphNode (그래프 노드)**

```typescript
interface GraphNode {
  id: string; // UUID
  documentId?: string; // FK to Document
  entityId?: string; // FK to Entity
  nodeType: 'document' | 'entity' | 'category' | 'concept';
  properties: {
    label: string;
    weight?: number;
    [key: string]: any;
  };
  createdAt: Date;
}

interface GraphEdge {
  id: string; // UUID
  sourceNodeId: string; // FK to GraphNode
  targetNodeId: string; // FK to GraphNode
  edgeType: 'mentions' | 'related_to' | 'cites' | 'belongs_to' | 'similar_to';
  weight: number; // 관계 강도 (0.0 ~ 1.0)
  properties: {
    [key: string]: any;
  };
  createdAt: Date;
}
```

**Conversation & Message (대화)**

```typescript
interface Conversation {
  id: string; // UUID
  userId: string; // FK to User
  title: string; // 대화 제목 (첫 메시지에서 자동 생성)
  createdAt: Date;
  updatedAt: Date;
}

interface Message {
  id: string; // UUID
  conversationId: string; // FK to Conversation
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: Citation[];
  agentSteps?: AgentStep[]; // Agentic Query 실행 단계
  createdAt: Date;
}
```

**SharedContent (공유 콘텐츠)**

```typescript
interface SharedContent {
  id: string; // UUID
  documentId: string; // FK to Document
  userId: string; // FK to User
  ipfsCid?: string; // IPFS Content ID
  arweaveTxId?: string; // Arweave Transaction ID
  ceramicStreamId?: string; // Ceramic Stream ID
  accessConditions: {
    type: 'wallet' | 'token' | 'nft' | 'public';
    addresses?: string[]; // 허용된 지갑 주소
    tokenAddress?: string; // 필요한 토큰 컨트랙트
    minBalance?: string; // 최소 토큰 보유량
    nftAddress?: string; // 필요한 NFT 컨트랙트
  };
  isRevoked: boolean;
  createdAt: Date;
  revokedAt?: Date;
}
```

### 데이터베이스 스키마 (PostgreSQL)

```sql
-- Users 테이블
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP,
    failed_login_count INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    settings JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_users_email ON users(email);

-- Documents 테이블
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    url TEXT,
    source_type VARCHAR(50) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    indexed_at TIMESTAMP
);

CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_created_at ON documents(created_at DESC);
CREATE INDEX idx_documents_source_type ON documents(source_type);
CREATE INDEX idx_documents_metadata ON documents USING GIN(metadata);

-- Entities 테이블
CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    properties JSONB DEFAULT '{}'::jsonb,
    extracted_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_entities_document_id ON entities(document_id);
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_entities_type ON entities(type);

-- Categories 테이블
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(7),
    depth INTEGER NOT NULL DEFAULT 0,
    path TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_categories_user_id ON categories(user_id);
CREATE INDEX idx_categories_parent_id ON categories(parent_id);
CREATE INDEX idx_categories_path ON categories(path);

-- Document-Category 관계 (다대다)
CREATE TABLE document_categories (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, category_id)
);

-- Vectors 테이블 (pgvector 사용)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    embedding vector(1536), -- 차원은 모델에 따라 조정
    model_name VARCHAR(100) NOT NULL,
    dimension INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_vectors_document_id ON vectors(document_id);
CREATE INDEX idx_vectors_embedding ON vectors USING ivfflat (embedding vector_cosine_ops);

-- Graph Nodes (Apache AGE 사용)
-- Apache AGE는 별도 그래프 스키마를 사용하므로 여기서는 메타데이터만 저장
CREATE TABLE graph_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    node_type VARCHAR(50) NOT NULL,
    properties JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_graph_nodes_document_id ON graph_nodes(document_id);
CREATE INDEX idx_graph_nodes_entity_id ON graph_nodes(entity_id);

-- Conversations 테이블
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conversations_user_id ON conversations(user_id);

-- Messages 테이블
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    citations JSONB DEFAULT '[]'::jsonb,
    agent_steps JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);

-- Shared Content 테이블
CREATE TABLE shared_content (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ipfs_cid TEXT,
    arweave_tx_id TEXT,
    ceramic_stream_id TEXT,
    access_conditions JSONB NOT NULL,
    is_revoked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    revoked_at TIMESTAMP
);

CREATE INDEX idx_shared_content_document_id ON shared_content(document_id);
CREATE INDEX idx_shared_content_user_id ON shared_content(user_id);
CREATE INDEX idx_shared_content_is_revoked ON shared_content(is_revoked);
```


## 오류 처리

### 오류 처리 전략

**계층별 오류 처리**

1. **클라이언트 계층**
   - 네트워크 오류: 자동 재시도 (최대 3회, 지수 백오프)
   - 타임아웃: 30초 후 사용자에게 알림
   - UI 오류: Error Boundary로 격리, 폴백 UI 표시

2. **API 게이트웨이 계층**
   - 인증 실패: 401 Unauthorized 반환
   - 권한 부족: 403 Forbidden 반환
   - 속도 제한 초과: 429 Too Many Requests 반환
   - 잘못된 요청: 400 Bad Request + 상세 오류 메시지

3. **애플리케이션 계층**
   - Ingestion 실패: 오류 로그 기록 + 사용자 알림
   - 파싱 오류: 원본 데이터 보존 + 수동 재시도 옵션
   - Agent 실행 오류: 안전한 종료 + 상태 롤백

4. **데이터 계층**
   - 데이터베이스 연결 실패: 자동 재연결 (최대 5회)
   - 쿼리 타임아웃: 10초 후 취소 + 오류 반환
   - 트랜잭션 실패: 자동 롤백 + 재시도

### 오류 코드 체계

```typescript
enum ErrorCode {
  // 인증 오류 (1000-1099)
  AUTH_INVALID_CREDENTIALS = 1001,
  AUTH_TOKEN_EXPIRED = 1002,
  AUTH_ACCOUNT_LOCKED = 1003,
  AUTH_INSUFFICIENT_PERMISSIONS = 1004,

  // Ingestion 오류 (2000-2099)
  INGEST_INVALID_URL = 2001,
  INGEST_FETCH_FAILED = 2002,
  INGEST_PARSE_FAILED = 2003,
  INGEST_UNSUPPORTED_FORMAT = 2004,

  // 검색 오류 (3000-3099)
  SEARCH_INVALID_QUERY = 3001,
  SEARCH_TIMEOUT = 3002,
  SEARCH_NO_RESULTS = 3003,

  // 카테고리 오류 (4000-4099)
  CATEGORY_NOT_FOUND = 4001,
  CATEGORY_DUPLICATE_NAME = 4002,
  CATEGORY_CIRCULAR_REFERENCE = 4003,

  // Agent 오류 (5000-5099)
  AGENT_EXECUTION_FAILED = 5001,
  AGENT_TIMEOUT = 5002,
  AGENT_RESOURCE_LIMIT = 5003,

  // 시스템 오류 (9000-9099)
  SYSTEM_DATABASE_ERROR = 9001,
  SYSTEM_NETWORK_ERROR = 9002,
  SYSTEM_INTERNAL_ERROR = 9003,
}

interface ErrorResponse {
  code: ErrorCode;
  message: string;
  details?: any;
  timestamp: string;
  requestId: string;
}
```

### 로깅 및 모니터링

**로그 레벨**
- ERROR: 시스템 오류, 복구 불가능한 오류
- WARN: 경고, 잠재적 문제
- INFO: 일반 정보, 주요 이벤트
- DEBUG: 디버깅 정보 (개발 환경만)

**로그 형식**
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "ERROR",
  "service": "ingestion-pipeline",
  "message": "Failed to fetch URL",
  "error": {
    "code": 2002,
    "message": "Connection timeout",
    "stack": "..."
  },
  "context": {
    "userId": "user_123",
    "url": "https://example.com",
    "requestId": "req_456"
  }
}
```

## 테스트 전략

### 테스트 접근 방식

SayknowMind는 **이중 테스트 접근 방식**을 사용한다:

1. **단위 테스트 (Unit Tests)**
   - 특정 예제 및 엣지 케이스 검증
   - 통합 지점 테스트
   - 오류 조건 테스트

2. **속성 기반 테스트 (Property-Based Tests)**
   - 모든 입력에 대한 보편적 속성 검증
   - 무작위 입력 생성을 통한 포괄적 커버리지
   - 최소 100회 반복 실행

### 테스트 라이브러리

- **JavaScript/TypeScript**: fast-check
- **Python**: Hypothesis
- **Rust**: proptest
- **Go**: gopter

### 테스트 구성

각 속성 기반 테스트는 다음 형식으로 태그를 포함한다:

```typescript
// Feature: sayknowmind-v0.1.0, Property 1: [속성 설명]
test('property: [속성 이름]', async () => {
  await fc.assert(
    fc.asyncProperty(
      // 생성기 정의
      fc.string(),
      async (input) => {
        // 속성 검증
      }
    ),
    { numRuns: 100 } // 최소 100회 반복
  );
});
```

### 테스트 커버리지 목표

- 코드 커버리지: 80% 이상
- 속성 기반 테스트: 모든 핵심 기능
- 통합 테스트: 주요 사용자 플로우
- E2E 테스트: 크리티컬 패스

## 보안 설계

### 인증 및 인가

**인증 메커니즘**
- better-auth 라이브러리 사용
- bcrypt 해시 (cost factor: 12)
- JWT 토큰 (HS256 알고리즘)
- 토큰 만료: 24시간
- 리프레시 토큰: 30일

**계정 보호**
- 5회 연속 로그인 실패 시 15분 잠금
- 비밀번호 요구사항:
  - 최소 8자
  - 대소문자, 숫자, 특수문자 포함
- 비밀번호 재설정: 이메일 인증

### 데이터 보안

**저장 데이터 암호화**
- AES-256-GCM 암호화
- 사용자별 암호화 키
- 키 관리: 환경 변수 또는 KMS

**전송 데이터 암호화**
- TLS 1.3 필수
- HSTS 헤더 설정
- 인증서 자동 갱신 (Let's Encrypt)

**Shared Mode 암호화**
- Lit Protocol v3 조건부 암호화
- age 암호화 (추가 계층)
- 클라이언트 측 암호화

### OWASP Top 10 방어

1. **Injection**: Prepared Statements, 입력 검증
2. **Broken Authentication**: better-auth, 계정 잠금
3. **Sensitive Data Exposure**: AES-256 암호화, TLS 1.3
4. **XML External Entities**: XML 파싱 비활성화
5. **Broken Access Control**: 역할 기반 접근 제어
6. **Security Misconfiguration**: 보안 헤더, 기본값 변경
7. **XSS**: React 자동 이스케이프, CSP 헤더
8. **Insecure Deserialization**: JSON 스키마 검증
9. **Using Components with Known Vulnerabilities**: 자동 의존성 스캔
10. **Insufficient Logging**: 구조화된 로깅, 감사 추적

### 봇 차단

**감지 기법**
- User-Agent 분석
- 요청 패턴 분석 (속도, 간격)
- JavaScript 챌린지
- CAPTCHA (의심스러운 경우만)

**차단 정책**
- IP 기반 속도 제한: 100 req/min
- 사용자 기반 속도 제한: 1000 req/hour
- 차단 기간: 1시간 (점진적 증가)

### Private Mode 보안

**네트워크 격리**
- 외부 네트워크 차단 (iptables/nftables)
- 허용 목록: Tailscale, Syncthing만
- DNS 쿼리 차단

**로컬 데이터 보호**
- 파일 시스템 권한: 600 (소유자만)
- Docker Volume 암호화
- 메모리 내 데이터 보호 (mlock)

## 배포 아키텍처

### Docker Compose 구성

```yaml
version: '3.8'

services:
  frontend:
    image: sayknowmind/frontend:v0.1.0
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/sayknowmind
      - AI_SERVER_URL=http://ai-server:4000
      - EDGEQUAKE_URL=http://edgequake:8080
    depends_on:
      - postgres
      - ai-server
      - edgequake
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  ai-server:
    image: sayknowmind/ai-server:v0.1.0
    ports:
      - "4000:4000"
    volumes:
      - model_cache:/app/models
    environment:
      - MODEL_CACHE_DIR=/app/models
      - OLLAMA_URL=http://host.docker.internal:11434
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 8G
        reservations:
          memory: 4G

  edgequake:
    image: sayknowmind/edgequake:v0.5.1
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/sayknowmind
      - RUST_LOG=info
    depends_on:
      - postgres
    restart: unless-stopped

  zeroclaw:
    image: sayknowmind/zeroclaw:v0.1.7
    ports:
      - "8081:8081"
    environment:
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/sayknowmind
      - RUST_LOG=info
    depends_on:
      - postgres
    restart: unless-stopped

  mcp-server:
    image: sayknowmind/mcp-server:v0.1.0
    ports:
      - "8082:8082"
    environment:
      - EDGEQUAKE_URL=http://edgequake:8080
      - AUTH_SECRET=${AUTH_SECRET}
    depends_on:
      - edgequake
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=sayknowmind
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  db_data:
    driver: local
  model_cache:
    driver: local
  user_data:
    driver: local

networks:
  default:
    driver: bridge
```

### 설치 스크립트 (install.sh)

```bash
#!/bin/bash

set -e

echo "SayknowMind v0.1.0 설치 시작..."

# Docker 확인
if ! command -v docker &> /dev/null; then
    echo "Docker가 설치되지 않았습니다. https://docs.docker.com/get-docker/ 를 참조하세요."
    exit 1
fi

# Docker Compose 확인
if ! command -v docker-compose &> /dev/null; then
    echo "Docker Compose가 설치되지 않았습니다."
    exit 1
fi

# .env 파일 생성
if [ ! -f .env ]; then
    echo "환경 변수 파일 생성 중..."
    cat > .env << EOF
# Database
DATABASE_URL=postgresql://postgres:password@postgres:5432/sayknowmind
POSTGRES_PASSWORD=password

# Auth
AUTH_SECRET=$(openssl rand -hex 32)

# AI Server
AI_SERVER_URL=http://ai-server:4000
OLLAMA_URL=http://host.docker.internal:11434

# Mode
PRIVATE_MODE=true
EOF
    echo ".env 파일이 생성되었습니다."
fi

# Docker Compose 실행
echo "Docker 컨테이너 시작 중..."
docker-compose up -d

echo "설치 완료! http://localhost:3000 에서 접속하세요."
```

### 환경별 배포

**개발 환경**
- Docker Compose (로컬)
- Hot Reload 활성화
- 디버그 로깅

**스테이징 환경**
- Docker Compose (서버)
- 프로덕션 빌드
- 제한된 리소스

**프로덕션 환경**
- Kubernetes (선택사항)
- 고가용성 구성
- 자동 스케일링
- 모니터링 및 알림


## 정확성 속성 (Correctness Properties)

*속성(Property)은 시스템의 모든 유효한 실행에서 참이어야 하는 특성 또는 동작이다. 본질적으로 시스템이 무엇을 해야 하는지에 대한 형식적 진술이다. 속성은 사람이 읽을 수 있는 명세와 기계가 검증할 수 있는 정확성 보장 사이의 다리 역할을 한다.*

### 인수 조건 테스트 가능성 사전 분석

**요구사항 1: 프론트엔드 웹 애플리케이션**

1.1. THE Frontend SHALL 렌더링에 Next.js 16과 React 19를 사용한다
  생각: 이것은 기술 스택 선택에 관한 것으로, 기능적 요구사항이 아니다.
  테스트 가능: 아니오

1.2. THE Frontend SHALL square-ui/bookmarks 템플릿을 기반 레이아웃으로 적용한다
  생각: 이것은 구현 세부사항으로, 자동화된 테스트로 검증하기 어렵다.
  테스트 가능: 아니오

1.3. THE Frontend SHALL UI 컴포넌트에 shadcn/ui와 Tailwind CSS를 사용한다
  생각: 이것은 기술 스택 선택에 관한 것이다.
  테스트 가능: 아니오

1.4. THE Frontend SHALL Vercel AI SDK를 통해 AI 기능과 통합한다
  생각: 이것은 통합 방식에 관한 것으로, 기능적 속성이 아니다.
  테스트 가능: 아니오

1.5. THE Frontend SHALL 브랜딩 컬러 시스템을 적용한다
  생각: 이것은 UI 디자인 요구사항으로, 자동화된 테스트로 검증하기 어렵다.
  테스트 가능: 아니오

1.6. THE Frontend SHALL 타이포그래피에 Inter, Space Grotesk, Satoshi 폰트를 사용한다
  생각: 이것은 디자인 요구사항이다.
  테스트 가능: 아니오

1.7. THE Frontend SHALL 한국어와 영어를 기본 지원 언어로 제공한다
  생각: 이것은 다국어 지원에 관한 것으로, 특정 UI 텍스트가 번역되었는지 확인할 수 있다.
  테스트 가능: 예 - 예제

1.8. WHEN 사용자가 언어를 전환하면, THE Frontend SHALL 페이지 새로고침 없이 UI 텍스트를 해당 언어로 변경한다
  생각: 이것은 모든 UI 텍스트에 적용되는 규칙이다. 무작위 UI 요소를 생성하고 언어 전환 후 텍스트가 변경되는지 확인할 수 있다.
  테스트 가능: 예 - 속성


**요구사항 2: 인증 시스템**

2.1. THE Auth_Module SHALL better-auth 라이브러리를 사용하여 인증 기능을 구현한다
  생각: 이것은 구현 세부사항이다.
  테스트 가능: 아니오

2.2. THE Auth_Module SHALL 이메일/비밀번호 기반 회원가입 기능을 제공한다
  생각: 이것은 특정 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

2.3. THE Auth_Module SHALL 이메일/비밀번호 기반 로그인 기능을 제공한다
  생각: 이것은 특정 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

2.4. WHEN 인증되지 않은 사용자가 보호된 리소스에 접근하면, THE Auth_Module SHALL 해당 요청을 차단하고 로그인 페이지로 리다이렉트한다
  생각: 이것은 모든 보호된 리소스에 적용되는 규칙이다. 무작위 보호된 엔드포인트를 생성하고 인증 없이 접근 시 차단되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

2.5. WHEN 로그인에 5회 연속 실패하면, THE Auth_Module SHALL 해당 계정을 15분간 잠금 처리한다
  생각: 이것은 특정 조건(5회 실패)에서의 동작을 테스트하는 것이다.
  테스트 가능: 예 - 예제

2.6. THE Auth_Module SHALL 세션 토큰을 안전하게 관리하고 만료 시 자동으로 갱신한다
  생각: 이것은 모든 세션 토큰에 적용되는 규칙이다. 무작위 토큰을 생성하고 만료 후 갱신되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

**요구사항 3: 봇 감지 및 차단**

3.1. THE AntiBot_Module SHALL 수신되는 요청에서 봇 트래픽 패턴을 분석한다
  생각: 이것은 시스템이 수행해야 하는 작업이지만, "분석"이 무엇을 의미하는지 명확하지 않다.
  테스트 가능: 아니오

3.2. WHEN 봇 트래픽이 감지되면, THE AntiBot_Module SHALL 해당 요청을 차단하고 로그에 기록한다
  생각: 이것은 모든 봇 트래픽에 적용되는 규칙이다. 무작위 봇 패턴을 생성하고 차단되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

3.3. THE AntiBot_Module SHALL 정상 사용자의 요청을 봇으로 오탐하는 비율을 1% 미만으로 유지한다
  생각: 이것은 성능 메트릭으로, 통계적 테스트가 필요하다.
  테스트 가능: 아니오 (성능 테스트)

3.4. WHEN 차단된 요청이 발생하면, THE AntiBot_Module SHALL 차단 사유와 타임스탬프를 포함한 로그 항목을 생성한다
  생각: 이것은 모든 차단된 요청에 적용되는 규칙이다. 무작위 차단 이벤트를 생성하고 로그에 필요한 정보가 포함되는지 확인할 수 있다.
  테스트 가능: 예 - 속성


**요구사항 4: 자동 Ingestion (Phase A)**

4.1. WHEN 사용자가 파일을 대시보드에 드래그 앤 드롭하면, THE Ingestion_Pipeline SHALL 해당 파일을 파싱하여 Document로 저장한다
  생각: 이것은 모든 유효한 파일에 적용되는 규칙이다. 무작위 파일을 생성하고 Document로 저장되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

4.2. WHEN 사용자가 URL을 붙여넣으면, THE Ingestion_Pipeline SHALL crawl4ai와 vakra-dev/reader를 사용하여 해당 웹 페이지 콘텐츠를 수집한다
  생각: 이것은 구현 세부사항(특정 라이브러리 사용)을 포함하지만, 핵심은 URL에서 콘텐츠를 수집하는 것이다.
  테스트 가능: 예 - 속성

4.3. WHEN 사용자가 브라우저 확장 프로그램을 통해 페이지를 저장하면, THE Ingestion_Pipeline SHALL 해당 페이지 콘텐츠를 수집하여 Document로 저장한다
  생각: 이것은 특정 입력 소스(브라우저 확장)에서의 동작이다.
  테스트 가능: 예 - 예제

4.4. WHEN Document가 저장되면, THE Ingestion_Pipeline SHALL 해당 Document의 자동 요약을 생성한다
  생각: 이것은 모든 Document에 적용되는 규칙이다. 무작위 Document를 생성하고 요약이 생성되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

4.5. WHEN Document가 저장되면, THE Ingestion_Pipeline SHALL 해당 Document에서 Entity를 자동 추출한다
  생각: 이것은 모든 Document에 적용되는 규칙이다.
  테스트 가능: 예 - 속성

4.6. WHEN Document가 저장되면, THE Ingestion_Pipeline SHALL 콘텐츠 분석 결과를 기반으로 동적 카테고리를 자동 할당한다
  생각: 이것은 모든 Document에 적용되는 규칙이다.
  테스트 가능: 예 - 속성

4.7. THE Ingestion_Pipeline SHALL tf-playwright-stealth를 사용하여 JavaScript 렌더링이 필요한 웹 페이지를 수집한다
  생각: 이것은 구현 세부사항이다.
  테스트 가능: 아니오

4.8. THE Ingestion_Pipeline SHALL Scrapling을 사용하여 구조화된 데이터를 추출한다
  생각: 이것은 구현 세부사항이다.
  테스트 가능: 아니오

4.9. IF Ingestion 과정에서 파싱 오류가 발생하면, THEN THE Ingestion_Pipeline SHALL 오류 상세 정보를 로그에 기록하고 사용자에게 실패 알림을 표시한다
  생각: 이것은 오류 조건에서의 동작이다. 무작위 잘못된 입력을 생성하고 오류 처리가 올바른지 확인할 수 있다.
  테스트 가능: 예 - 속성

**요구사항 5: 지식 탐색 및 채팅 (Phase B)**

5.1. THE EdgeQuake_Engine SHALL 6가지 Query Mode를 제공한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

5.2. WHEN 사용자가 자연어 검색 쿼리를 입력하면, THE EdgeQuake_Engine SHALL 관련 Document를 검색하여 결과를 반환한다
  생각: 이것은 모든 검색 쿼리에 적용되는 규칙이다. 무작위 쿼리를 생성하고 결과가 반환되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

5.3. WHEN 검색 쿼리가 실행되면, THE EdgeQuake_Engine SHALL 200ms 이내에 검색 결과를 반환한다
  생각: 이것은 성능 요구사항이다.
  테스트 가능: 아니오 (성능 테스트)

5.4. WHEN 검색 결과가 반환되면, THE SayknowMind_System SHALL 각 결과에 원본 Document의 Citation을 포함한다
  생각: 이것은 모든 검색 결과에 적용되는 규칙이다. 무작위 검색을 수행하고 모든 결과에 Citation이 포함되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

5.5. THE SayknowMind_System SHALL Agentic Query 기능을 제공하여 복잡한 질문에 대해 멀티 스텝 추론을 수행한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

5.6. WHEN 채팅 응답이 생성되면, THE Frontend SHALL 실시간 스트리밍 방식으로 응답 텍스트를 표시한다
  생각: 이것은 UI 동작으로, 스트리밍이 작동하는지 확인할 수 있다.
  테스트 가능: 예 - 예제

5.7. THE EdgeQuake_Engine SHALL Apache AGE 그래프 DB와 pgvector 벡터 DB를 결합한 하이브리드 검색을 수행한다
  생각: 이것은 구현 세부사항이다.
  테스트 가능: 아니오


**요구사항 6: RAG 대시보드 및 그래프 시각화**

6.1. THE Frontend SHALL React 19 기반 RAG 대시보드를 제공한다
  생각: 이것은 기술 스택 선택이다.
  테스트 가능: 아니오

6.2. THE Frontend SHALL Sigma.js를 사용하여 지식 그래프를 인터랙티브하게 시각화한다
  생각: 이것은 구현 세부사항이다.
  테스트 가능: 아니오

6.3. WHEN 사용자가 그래프의 노드를 클릭하면, THE Frontend SHALL 해당 Entity의 상세 정보와 연결된 Document 목록을 표시한다
  생각: 이것은 모든 그래프 노드에 적용되는 규칙이다. 무작위 노드를 생성하고 클릭 시 정보가 표시되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

6.4. WHEN 사용자가 검색을 수행하면, THE Frontend SHALL 검색 결과와 관련된 그래프 영역을 하이라이트한다
  생각: 이것은 UI 동작으로, 특정 검색에 대한 하이라이트를 확인할 수 있다.
  테스트 가능: 예 - 예제

6.5. THE Frontend SHALL 그래프에서 줌, 패닝, 필터링 인터랙션을 지원한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

**요구사항 7: 카테고리 관리 (Phase C)**

7.1. THE Category_Manager SHALL 트리 구조 UI를 제공하여 카테고리 계층을 표시한다
  생각: 이것은 UI 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

7.2. THE Category_Manager SHALL React Flow 기반 그래프 UI를 제공하여 카테고리 간 관계를 시각화한다
  생각: 이것은 구현 세부사항이다.
  테스트 가능: 아니오

7.3. WHEN 사용자가 카테고리를 생성하면, THE Category_Manager SHALL 해당 카테고리를 트리와 그래프 UI에 동시에 반영한다
  생각: 이것은 모든 카테고리 생성에 적용되는 규칙이다. 무작위 카테고리를 생성하고 두 UI에 모두 반영되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

7.4. WHEN 사용자가 카테고리를 드래그 앤 드롭으로 이동하면, THE Category_Manager SHALL 카테고리 계층 구조를 업데이트한다
  생각: 이것은 모든 카테고리 이동에 적용되는 규칙이다.
  테스트 가능: 예 - 속성

7.5. WHEN 사용자가 카테고리 이름을 편집하면, THE Category_Manager SHALL 해당 카테고리를 참조하는 모든 Document의 카테고리 정보를 갱신한다
  생각: 이것은 모든 카테고리 편집에 적용되는 규칙이다. 무작위 카테고리와 Document를 생성하고 이름 변경 후 모든 참조가 갱신되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

7.6. WHEN 새로운 Document가 수집되면, THE Category_Manager SHALL Agent를 통해 적합한 카테고리 배치를 자동으로 제안한다
  생각: 이것은 모든 새 Document에 적용되는 규칙이다.
  테스트 가능: 예 - 속성

7.7. WHEN Agent가 카테고리 제안을 생성하면, THE Category_Manager SHALL 제안 사유와 신뢰도 점수를 함께 표시한다
  생각: 이것은 모든 카테고리 제안에 적용되는 규칙이다. 무작위 제안을 생성하고 사유와 점수가 포함되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

7.8. WHEN 사용자가 Agent의 카테고리 제안을 승인하면, THE Category_Manager SHALL 해당 Document를 제안된 카테고리에 할당한다
  생각: 이것은 모든 제안 승인에 적용되는 규칙이다.
  테스트 가능: 예 - 속성

7.9. WHEN 사용자가 Agent의 카테고리 제안을 거부하면, THE Category_Manager SHALL 거부 피드백을 학습 데이터로 저장한다
  생각: 이것은 모든 제안 거부에 적용되는 규칙이다.
  테스트 가능: 예 - 속성

7.10. THE Category_Manager SHALL 카테고리 병합 기능을 제공하여 중복 카테고리를 통합한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제


**요구사항 8: Cross-Platform Skill / MCP Server (Phase D)**

8.1. THE MCP_Server SHALL Model Context Protocol 표준을 준수하는 서버를 제공한다
  생각: 이것은 표준 준수에 관한 것으로, 프로토콜 검증이 필요하다.
  테스트 가능: 예 - 예제

8.2. THE MCP_Server SHALL 외부 AI 플랫폼에서 @SayknowMind Skill로 호출 가능한 엔드포인트를 노출한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

8.3. WHEN 외부 AI 플랫폼에서 검색 요청이 수신되면, THE MCP_Server SHALL EdgeQuake_Engine을 통해 검색을 수행하고 결과를 반환한다
  생각: 이것은 모든 검색 요청에 적용되는 규칙이다. 무작위 MCP 검색 요청을 생성하고 결과가 반환되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

8.4. WHEN 외부 AI 플랫폼에서 Document 수집 요청이 수신되면, THE MCP_Server SHALL Ingestion_Pipeline을 통해 해당 콘텐츠를 수집한다
  생각: 이것은 모든 수집 요청에 적용되는 규칙이다.
  테스트 가능: 예 - 속성

8.5. THE MCP_Server SHALL 요청별 인증 토큰을 검증하여 권한이 없는 접근을 차단한다
  생각: 이것은 모든 요청에 적용되는 규칙이다. 무작위 토큰(유효/무효)을 생성하고 검증이 올바른지 확인할 수 있다.
  테스트 가능: 예 - 속성

8.6. THE MCP_Server SHALL Claude Desktop, ChatGPT Plugin, Cursor, Windsurf 플랫폼과의 연동을 지원한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

8.7. WHEN MCP_Server에 연결 오류가 발생하면, THE MCP_Server SHALL 자동 재연결을 3회까지 시도하고 실패 시 오류 상태를 클라이언트에 반환한다
  생각: 이것은 오류 조건에서의 동작이다.
  테스트 가능: 예 - 예제

**요구사항 9: SDK**

9.1. THE SDK SHALL Python, TypeScript, Go 세 가지 언어로 클라이언트 라이브러리를 제공한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

9.2. THE SDK SHALL Document 수집, 검색, 카테고리 관리 API를 래핑한 함수를 제공한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

9.3. THE SDK SHALL 각 언어별 패키지 매니저를 통한 설치를 지원한다
  생각: 이것은 배포 방식에 관한 것이다.
  테스트 가능: 예 - 예제

9.4. THE SDK SHALL API 요청/응답 직렬화 및 역직렬화를 수행한다
  생각: 이것은 직렬화 기능에 관한 것으로, 라운드트립 속성으로 테스트할 수 있다.
  테스트 가능: 예 - 속성 (요구사항 9.5에서 명시)

9.5. FOR ALL 유효한 API 요청 객체에 대해, SDK로 직렬화한 후 역직렬화하면 원본과 동일한 객체를 생성한다
  생각: 이것은 명시적인 라운드트립 속성이다. 무작위 API 요청 객체를 생성하고 직렬화/역직렬화 후 동일한지 확인할 수 있다.
  테스트 가능: 예 - 속성

9.6. THE SDK SHALL 각 언어별 관용적 에러 핸들링 패턴을 따른다
  생각: 이것은 구현 스타일에 관한 것이다.
  테스트 가능: 아니오

9.7. THE SDK SHALL API 레퍼런스 문서와 사용 예제를 포함한다
  생각: 이것은 문서화 요구사항이다.
  테스트 가능: 아니오


**요구사항 10: Private Mode**

10.1. THE Private_Mode SHALL 모든 사용자 데이터를 로컬 스토리지에만 저장한다
  생각: 이것은 모든 데이터 저장에 적용되는 규칙이다. 무작위 데이터를 생성하고 로컬에만 저장되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

10.2. THE Private_Mode SHALL Docker Compose를 사용한 1클릭 설치를 지원한다
  생각: 이것은 배포 방식에 관한 것이다.
  테스트 가능: 예 - 예제

10.3. WHEN Private_Mode가 활성화되면, THE SayknowMind_System SHALL 외부 네트워크로의 모든 아웃바운드 연결을 차단한다
  생각: 이것은 모든 네트워크 연결 시도에 적용되는 규칙이다. 무작위 외부 URL을 생성하고 연결이 차단되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

10.4. THE Private_Mode SHALL Tailscale을 통한 디바이스 간 보안 네트워크 연결을 지원한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

10.5. THE Private_Mode SHALL Syncthing을 통한 디바이스 간 데이터 동기화를 지원한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

10.6. WHEN 동기화 충돌이 발생하면, THE Private_Mode SHALL 충돌 항목을 사용자에게 표시하고 수동 해결 옵션을 제공한다
  생각: 이것은 충돌 조건에서의 동작이다. 무작위 충돌 시나리오를 생성하고 올바르게 처리되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

10.7. THE Private_Mode SHALL 로컬 LLM을 사용하여 외부 API 호출 없이 AI 기능을 제공한다
  생각: 이것은 구현 방식에 관한 것이다.
  테스트 가능: 아니오

10.8. WHILE Private_Mode가 활성 상태인 동안, THE SayknowMind_System SHALL 텔레메트리 데이터를 수집하거나 전송하지 않는다
  생각: 이것은 Private Mode 동안의 지속적인 조건이다. 무작위 시간 동안 모니터링하여 텔레메트리 전송이 없는지 확인할 수 있다.
  테스트 가능: 예 - 속성

**요구사항 11: Shared Mode**

11.1. THE Shared_Mode SHALL Lit Protocol v3를 사용하여 콘텐츠 접근 제어를 수행한다
  생각: 이것은 구현 세부사항이다.
  테스트 가능: 아니오

11.2. THE Shared_Mode SHALL IPFS를 사용하여 공유 콘텐츠를 분산 저장한다
  생각: 이것은 구현 세부사항이다.
  테스트 가능: 아니오

11.3. THE Shared_Mode SHALL Arweave를 사용하여 영구 저장이 필요한 콘텐츠를 보관한다
  생각: 이것은 구현 세부사항이다.
  테스트 가능: 아니오

11.4. THE Shared_Mode SHALL Ceramic Network를 사용하여 공유 메타데이터를 관리한다
  생각: 이것은 구현 세부사항이다.
  테스트 가능: 아니오

11.5. WHEN 사용자가 Document를 공유하면, THE Shared_Mode SHALL 해당 Document를 암호화한 후 분산 네트워크에 업로드한다
  생각: 이것은 모든 Document 공유에 적용되는 규칙이다. 무작위 Document를 생성하고 공유 후 암호화되어 업로드되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

11.6. WHEN 사용자가 공유 링크를 생성하면, THE Shared_Mode SHALL 접근 조건을 설정할 수 있는 인터페이스를 제공한다
  생각: 이것은 UI 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

11.7. WHEN 사용자가 공유 권한을 철회하면, THE Shared_Mode SHALL Lit Protocol을 통해 해당 접근 조건을 즉시 무효화한다
  생각: 이것은 모든 권한 철회에 적용되는 규칙이다. 무작위 공유를 생성하고 철회 후 접근이 차단되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

11.8. WHEN 권한이 없는 사용자가 공유 콘텐츠에 접근하면, THE Shared_Mode SHALL 접근을 차단하고 권한 부족 메시지를 표시한다
  생각: 이것은 모든 무단 접근 시도에 적용되는 규칙이다. 무작위 권한 없는 사용자를 생성하고 접근이 차단되는지 확인할 수 있다.
  테스트 가능: 예 - 속성


**요구사항 12: 데스크톱 앱**

12.1. THE Desktop_App SHALL Tauri 프레임워크를 사용하여 웹 애플리케이션을 데스크톱 앱으로 패키징한다
  생각: 이것은 구현 세부사항이다.
  테스트 가능: 아니오

12.2. THE Desktop_App SHALL Windows, macOS, Linux 운영체제를 지원한다
  생각: 이것은 플랫폼 지원에 관한 것이다.
  테스트 가능: 예 - 예제

12.3. THE Desktop_App SHALL 시스템 트레이 아이콘을 제공하여 백그라운드 실행을 지원한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

12.4. WHEN 사용자가 Desktop_App을 실행하면, THE Desktop_App SHALL 로컬 서비스를 자동으로 시작한다
  생각: 이것은 앱 시작 시의 동작이다.
  테스트 가능: 예 - 예제

12.5. THE Desktop_App SHALL 글로벌 단축키를 제공하여 빠른 검색 창을 호출한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

12.6. THE Desktop_App SHALL 자동 업데이트 기능을 제공하여 새 버전 출시 시 사용자에게 알림을 표시한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

12.7. WHEN Desktop_App이 오프라인 상태이면, THE Desktop_App SHALL 로컬에 저장된 데이터를 기반으로 검색 및 탐색 기능을 제공한다
  생각: 이것은 오프라인 조건에서의 동작이다. 무작위 오프라인 시나리오를 생성하고 기능이 작동하는지 확인할 수 있다.
  테스트 가능: 예 - 속성

**요구사항 13: 모바일 앱**

13.1. THE Mobile_App SHALL Android와 iOS 플랫폼을 지원한다
  생각: 이것은 플랫폼 지원에 관한 것이다.
  테스트 가능: 예 - 예제

13.2. THE Mobile_App SHALL Tauri 또는 Capacitor 프레임워크를 사용하여 빌드한다
  생각: 이것은 구현 세부사항이다.
  테스트 가능: 아니오

13.3. THE Mobile_App SHALL 모바일 화면 크기에 최적화된 반응형 UI를 제공한다
  생각: 이것은 UI 디자인 요구사항이다.
  테스트 가능: 아니오

13.4. WHEN 사용자가 모바일 브라우저에서 콘텐츠를 공유하면, THE Mobile_App SHALL 공유 인텐트를 수신하여 Ingestion_Pipeline으로 전달한다
  생각: 이것은 모든 공유 인텐트에 적용되는 규칙이다. 무작위 공유 데이터를 생성하고 올바르게 처리되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

13.5. THE Mobile_App SHALL 오프라인 모드를 지원하여 네트워크 연결 없이 캐시된 데이터를 검색한다
  생각: 이것은 오프라인 조건에서의 동작이다.
  테스트 가능: 예 - 예제

13.6. WHEN 네트워크 연결이 복구되면, THE Mobile_App SHALL 오프라인 중 수집된 데이터를 자동으로 동기화한다
  생각: 이것은 네트워크 복구 시의 동작이다. 무작위 오프라인 데이터를 생성하고 동기화되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

13.7. THE Mobile_App SHALL 푸시 알림을 통해 새로운 Agent 제안이나 수집 완료 상태를 사용자에게 전달한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

**요구사항 14: Agent Runtime**

14.1. THE ZeroClaw_Runtime SHALL v0.1.7의 안전성이 검증된 기능만 사용한다
  생각: 이것은 구현 제약사항이다.
  테스트 가능: 아니오

14.2. THE LangGraph_Orchestrator SHALL Stateful 멀티 에이전트 워크플로우를 관리한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

14.3. WHEN 복잡한 질의가 수신되면, THE LangGraph_Orchestrator SHALL 작업을 하위 태스크로 분해하고 적절한 Agent에 할당한다
  생각: 이것은 모든 복잡한 질의에 적용되는 규칙이다. 무작위 복잡한 질의를 생성하고 분해되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

14.4. THE LangGraph_Orchestrator SHALL Agent 간 메시지 전달과 상태 공유를 관리한다
  생각: 이것은 시스템 기능이지만, "관리"가 무엇을 의미하는지 명확하지 않다.
  테스트 가능: 아니오

14.5. WHEN Agent 실행 중 오류가 발생하면, THE ZeroClaw_Runtime SHALL 해당 Agent를 안전하게 종료하고 오류 상태를 LangGraph_Orchestrator에 보고한다
  생각: 이것은 모든 Agent 오류에 적용되는 규칙이다. 무작위 오류 조건을 생성하고 올바르게 처리되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

14.6. THE ZeroClaw_Runtime SHALL 각 Agent의 리소스 사용량을 모니터링하고 설정된 한도를 초과하면 실행을 제한한다
  생각: 이것은 모든 Agent에 적용되는 규칙이다. 무작위 리소스 사용 패턴을 생성하고 한도 초과 시 제한되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

14.7. THE LangGraph_Orchestrator SHALL Agent 실행 이력과 결과를 로그로 기록하여 디버깅을 지원한다
  생각: 이것은 모든 Agent 실행에 적용되는 규칙이다. 무작위 Agent 실행을 생성하고 로그가 기록되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

14.8. WHILE Agent가 실행 중인 동안, THE Frontend SHALL 실행 상태와 진행률을 실시간으로 표시한다
  생각: 이것은 UI 동작이다.
  테스트 가능: 예 - 예제


**요구사항 15: Docker 배포**

15.1. THE SayknowMind_System SHALL Docker Compose 파일을 제공하여 모든 서비스를 1클릭으로 배포한다
  생각: 이것은 배포 방식에 관한 것이다.
  테스트 가능: 예 - 예제

15.2. THE SayknowMind_System SHALL install.sh 스크립트를 제공하여 사전 요구사항 확인과 초기 설정을 자동화한다
  생각: 이것은 배포 도구의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

15.3. WHEN install.sh 스크립트가 실행되면, THE SayknowMind_System SHALL Docker와 Docker Compose 설치 여부를 확인하고 미설치 시 안내 메시지를 표시한다
  생각: 이것은 스크립트 실행 시의 동작이다.
  테스트 가능: 예 - 예제

15.4. THE SayknowMind_System SHALL 환경 변수 기반 설정을 지원하여 .env 파일로 서비스 구성을 커스터마이징한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

15.5. THE SayknowMind_System SHALL 각 서비스를 독립된 컨테이너로 실행한다
  생각: 이것은 배포 아키텍처에 관한 것이다.
  테스트 가능: 예 - 예제

15.6. WHEN Docker 컨테이너가 비정상 종료되면, THE SayknowMind_System SHALL 해당 컨테이너를 자동으로 재시작한다
  생각: 이것은 모든 컨테이너 종료에 적용되는 규칙이다. 무작위 컨테이너 종료를 시뮬레이션하고 재시작되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

15.7. THE SayknowMind_System SHALL 데이터 영속성을 위해 Docker Volume을 사용하여 데이터베이스와 사용자 데이터를 보존한다
  생각: 이것은 모든 데이터에 적용되는 규칙이다. 무작위 데이터를 생성하고 컨테이너 재시작 후에도 보존되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

15.8. THE SayknowMind_System SHALL 컨테이너 헬스체크를 구성하여 각 서비스의 정상 동작 여부를 모니터링한다
  생각: 이것은 기능의 존재를 확인하는 것이다.
  테스트 가능: 예 - 예제

**요구사항 16: 비기능 요구사항**

16.1. WHEN 검색 쿼리가 실행되면, THE SayknowMind_System SHALL 200ms 이내에 응답을 반환한다
  생각: 이것은 성능 요구사항이다.
  테스트 가능: 아니오 (성능 테스트)

16.2. WHEN 페이지가 로드되면, THE Frontend SHALL 초기 렌더링을 1초 이내에 완료한다
  생각: 이것은 성능 요구사항이다.
  테스트 가능: 아니오 (성능 테스트)

16.3. THE SayknowMind_System SHALL 10만 개 이상의 Document를 저장하고 검색 성능을 유지한다
  생각: 이것은 확장성 요구사항이다.
  테스트 가능: 아니오 (성능 테스트)

16.4. THE SayknowMind_System SHALL 모든 저장 데이터를 AES-256 암호화로 보호한다
  생각: 이것은 모든 저장 데이터에 적용되는 규칙이다. 무작위 데이터를 생성하고 암호화되어 저장되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

16.5. THE SayknowMind_System SHALL OWASP Top 10 보안 취약점에 대한 방어 조치를 적용한다
  생각: 이것은 보안 목표이지만, 구체적인 테스트 가능한 조건이 아니다.
  테스트 가능: 아니오

16.6. THE SayknowMind_System SHALL 한국어, 영어, 일본어, 중국어를 포함한 다국어 콘텐츠의 수집과 검색을 지원한다
  생각: 이것은 모든 언어의 콘텐츠에 적용되는 규칙이다. 무작위 다국어 콘텐츠를 생성하고 수집/검색이 작동하는지 확인할 수 있다.
  테스트 가능: 예 - 속성

16.7. WHEN 시스템 장애가 발생하면, THE SayknowMind_System SHALL 자동 복구를 시도하고 데이터 손실 없이 서비스를 재개한다
  생각: 이것은 모든 장애 조건에 적용되는 규칙이다. 무작위 장애를 시뮬레이션하고 복구되는지 확인할 수 있다.
  테스트 가능: 예 - 속성

16.8. THE SayknowMind_System SHALL 99.9% 이상의 가용성을 목표로 운영한다
  생각: 이것은 가용성 목표로, 장기 모니터링이 필요하다.
  테스트 가능: 아니오 (운영 메트릭)

16.9. THE SayknowMind_System SHALL API 응답 형식으로 JSON을 사용한다
  생각: 이것은 모든 API 응답에 적용되는 규칙이다. 무작위 API 호출을 생성하고 응답이 JSON 형식인지 확인할 수 있다.
  테스트 가능: 예 - 속성

16.10. FOR ALL 유효한 API 응답 객체에 대해, JSON으로 직렬화한 후 역직렬화하면 원본과 동일한 객체를 생성한다
  생각: 이것은 명시적인 라운드트립 속성이다. 무작위 API 응답 객체를 생성하고 직렬화/역직렬화 후 동일한지 확인할 수 있다.
  테스트 가능: 예 - 속성

### 속성 반영 (Property Reflection)

위의 사전 분석을 검토하여 중복되거나 통합 가능한 속성을 식별한다:

**중복 제거 및 통합:**

1. **인증 관련 속성 (2.4, 2.6)**: 두 속성 모두 인증 시스템의 핵심 기능이지만, 서로 다른 측면을 다룬다. 2.4는 접근 제어, 2.6은 토큰 관리. 유지.

2. **Ingestion 관련 속성 (4.1, 4.2, 4.4, 4.5, 4.6)**: 모두 Document 저장 시의 동작이지만, 각각 다른 측면을 다룬다. 통합 가능: "Document 저장 시 파싱, 요약, Entity 추출, 카테고리 할당이 모두 수행된다"

3. **검색 관련 속성 (5.2, 5.4)**: 5.2는 검색 결과 반환, 5.4는 Citation 포함. 통합 가능: "검색 시 결과와 Citation이 함께 반환된다"

4. **카테고리 관련 속성 (7.3, 7.4, 7.5)**: 모두 카테고리 변경 시의 UI 업데이트이지만, 각각 다른 작업을 다룬다. 유지.

5. **MCP 관련 속성 (8.3, 8.4)**: 두 속성 모두 MCP 요청 처리이지만, 서로 다른 작업(검색 vs 수집)을 다룬다. 유지.

6. **Agent 관련 속성 (14.5, 14.6, 14.7)**: 모두 Agent 모니터링이지만, 각각 다른 측면(오류 처리, 리소스 제한, 로깅)을 다룬다. 유지.

7. **라운드트립 속성 (9.5, 16.10)**: 두 속성 모두 직렬화 라운드트립이지만, 서로 다른 객체(SDK 요청 vs API 응답)를 다룬다. 유지.

8. **데이터 저장 속성 (10.1, 15.7, 16.4)**: 10.1은 로컬 저장, 15.7은 영속성, 16.4는 암호화. 통합 가능: "모든 데이터는 로컬에 암호화되어 영속적으로 저장된다"

**통합 후 최종 속성 목록:**

- 언어 전환 시 UI 업데이트 (1.8)
- 인증되지 않은 접근 차단 (2.4)
- 세션 토큰 자동 갱신 (2.6)
- 봇 트래픽 차단 및 로깅 (3.2, 3.4) → 통합
- Document 수집 시 전체 파이프라인 실행 (4.1, 4.2, 4.4, 4.5, 4.6) → 통합
- Ingestion 오류 처리 (4.9)
- 검색 결과 및 Citation 반환 (5.2, 5.4) → 통합
- 그래프 노드 클릭 시 정보 표시 (6.3)
- 카테고리 생성 시 UI 동기화 (7.3)
- 카테고리 이동 시 계층 업데이트 (7.4)
- 카테고리 이름 변경 시 참조 갱신 (7.5)
- Document 수집 시 카테고리 자동 제안 (7.6, 7.7) → 통합
- 카테고리 제안 승인/거부 처리 (7.8, 7.9) → 통합
- MCP 검색 요청 처리 (8.3)
- MCP 수집 요청 처리 (8.4)
- MCP 인증 토큰 검증 (8.5)
- SDK 직렬화 라운드트립 (9.5)
- Private Mode 데이터 로컬 저장 및 암호화 (10.1, 16.4) → 통합
- Private Mode 네트워크 차단 (10.3)
- Private Mode 동기화 충돌 처리 (10.6)
- Private Mode 텔레메트리 차단 (10.8)
- Shared Mode Document 암호화 및 업로드 (11.5)
- Shared Mode 권한 철회 (11.7)
- Shared Mode 무단 접근 차단 (11.8)
- Desktop App 오프라인 기능 (12.7)
- Mobile App 공유 인텐트 처리 (13.4)
- Mobile App 네트워크 복구 시 동기화 (13.6)
- Agent 복잡한 질의 분해 (14.3)
- Agent 오류 처리 (14.5)
- Agent 리소스 제한 (14.6)
- Agent 실행 로깅 (14.7)
- Docker 컨테이너 자동 재시작 (15.6)
- Docker Volume 데이터 영속성 (15.7)
- 시스템 장애 자동 복구 (16.7)
- API 응답 JSON 형식 (16.9)
- API 응답 직렬화 라운드트립 (16.10)


### 정확성 속성 목록

### 속성 1: 언어 전환 시 UI 텍스트 변경

*모든* UI 요소에 대해, 사용자가 언어를 전환하면 페이지 새로고침 없이 해당 언어로 텍스트가 변경되어야 한다.

**검증: 요구사항 1.8**

### 속성 2: 인증되지 않은 접근 차단

*모든* 보호된 리소스에 대해, 인증되지 않은 사용자의 접근 시도는 차단되고 로그인 페이지로 리다이렉트되어야 한다.

**검증: 요구사항 2.4**

### 속성 3: 세션 토큰 자동 갱신

*모든* 세션 토큰에 대해, 만료 시 자동으로 갱신되어야 하며, 갱신 실패 시 사용자에게 재인증을 요청해야 한다.

**검증: 요구사항 2.6**

### 속성 4: 봇 트래픽 차단 및 로깅

*모든* 봇 트래픽 패턴이 감지된 요청에 대해, 해당 요청은 차단되고 차단 사유와 타임스탬프를 포함한 로그 항목이 생성되어야 한다.

**검증: 요구사항 3.2, 3.4**

### 속성 5: Document 수집 완전성

*모든* 유효한 입력(파일, URL)에 대해, Ingestion Pipeline은 Document를 저장하고, 요약을 생성하고, Entity를 추출하고, 카테고리를 할당해야 한다.

**검증: 요구사항 4.1, 4.2, 4.4, 4.5, 4.6**

### 속성 6: Ingestion 오류 처리

*모든* 파싱 오류에 대해, 오류 상세 정보가 로그에 기록되고 사용자에게 실패 알림이 표시되어야 한다.

**검증: 요구사항 4.9**

### 속성 7: 검색 결과 Citation 포함

*모든* 검색 쿼리에 대해, 반환된 결과의 각 항목은 원본 Document의 Citation을 포함해야 한다.

**검증: 요구사항 5.2, 5.4**

### 속성 8: 그래프 노드 상세 정보 표시

*모든* 그래프 노드에 대해, 사용자가 클릭하면 해당 Entity의 상세 정보와 연결된 Document 목록이 표시되어야 한다.

**검증: 요구사항 6.3**

### 속성 9: 카테고리 생성 시 UI 동기화

*모든* 카테고리 생성에 대해, 해당 카테고리는 트리 UI와 그래프 UI에 동시에 반영되어야 한다.

**검증: 요구사항 7.3**

### 속성 10: 카테고리 이동 시 계층 업데이트

*모든* 카테고리 드래그 앤 드롭 이동에 대해, 카테고리 계층 구조가 올바르게 업데이트되어야 한다.

**검증: 요구사항 7.4**

### 속성 11: 카테고리 이름 변경 시 참조 갱신

*모든* 카테고리 이름 편집에 대해, 해당 카테고리를 참조하는 모든 Document의 카테고리 정보가 갱신되어야 한다.

**검증: 요구사항 7.5**

### 속성 12: Document 수집 시 카테고리 자동 제안

*모든* 새로운 Document 수집에 대해, Agent는 적합한 카테고리 배치를 제안하고, 제안 사유와 신뢰도 점수를 함께 제공해야 한다.

**검증: 요구사항 7.6, 7.7**

### 속성 13: 카테고리 제안 처리

*모든* 카테고리 제안에 대해, 사용자가 승인하면 Document가 제안된 카테고리에 할당되고, 거부하면 거부 피드백이 학습 데이터로 저장되어야 한다.

**검증: 요구사항 7.8, 7.9**

### 속성 14: MCP 검색 요청 처리

*모든* 외부 AI 플랫폼의 검색 요청에 대해, MCP Server는 EdgeQuake Engine을 통해 검색을 수행하고 결과를 반환해야 한다.

**검증: 요구사항 8.3**

### 속성 15: MCP 수집 요청 처리

*모든* 외부 AI 플랫폼의 Document 수집 요청에 대해, MCP Server는 Ingestion Pipeline을 통해 콘텐츠를 수집해야 한다.

**검증: 요구사항 8.4**

### 속성 16: MCP 인증 토큰 검증

*모든* MCP 요청에 대해, 유효한 인증 토큰이 있으면 처리되고, 없으면 차단되어야 한다.

**검증: 요구사항 8.5**

### 속성 17: SDK 직렬화 라운드트립

*모든* 유효한 API 요청 객체에 대해, SDK로 직렬화한 후 역직렬화하면 원본과 동일한 객체가 생성되어야 한다.

**검증: 요구사항 9.5**

### 속성 18: Private Mode 데이터 로컬 저장 및 암호화

*모든* 사용자 데이터에 대해, Private Mode에서는 AES-256으로 암호화되어 로컬 스토리지에만 저장되어야 한다.

**검증: 요구사항 10.1, 16.4**

### 속성 19: Private Mode 네트워크 차단

*모든* 외부 네트워크 연결 시도에 대해, Private Mode가 활성화되면 차단되어야 한다.

**검증: 요구사항 10.3**

### 속성 20: Private Mode 동기화 충돌 처리

*모든* 동기화 충돌에 대해, 충돌 항목이 사용자에게 표시되고 수동 해결 옵션이 제공되어야 한다.

**검증: 요구사항 10.6**

### 속성 21: Private Mode 텔레메트리 차단

*모든* 시간 동안, Private Mode가 활성 상태이면 텔레메트리 데이터가 수집되거나 전송되지 않아야 한다.

**검증: 요구사항 10.8**

### 속성 22: Shared Mode Document 암호화 및 업로드

*모든* Document 공유에 대해, Document는 암호화된 후 분산 네트워크에 업로드되어야 한다.

**검증: 요구사항 11.5**

### 속성 23: Shared Mode 권한 철회

*모든* 공유 권한 철회에 대해, 해당 접근 조건이 즉시 무효화되고 이후 접근이 차단되어야 한다.

**검증: 요구사항 11.7**

### 속성 24: Shared Mode 무단 접근 차단

*모든* 권한이 없는 사용자의 공유 콘텐츠 접근 시도에 대해, 접근이 차단되고 권한 부족 메시지가 표시되어야 한다.

**검증: 요구사항 11.8**

### 속성 25: Desktop App 오프라인 기능

*모든* 오프라인 상태에서, Desktop App은 로컬에 저장된 데이터를 기반으로 검색 및 탐색 기능을 제공해야 한다.

**검증: 요구사항 12.7**

### 속성 26: Mobile App 공유 인텐트 처리

*모든* 모바일 브라우저의 공유 인텐트에 대해, Mobile App은 이를 수신하여 Ingestion Pipeline으로 전달해야 한다.

**검증: 요구사항 13.4**

### 속성 27: Mobile App 네트워크 복구 시 동기화

*모든* 네트워크 연결 복구에 대해, 오프라인 중 수집된 데이터가 자동으로 동기화되어야 한다.

**검증: 요구사항 13.6**

### 속성 28: Agent 복잡한 질의 분해

*모든* 복잡한 질의에 대해, LangGraph Orchestrator는 작업을 하위 태스크로 분해하고 적절한 Agent에 할당해야 한다.

**검증: 요구사항 14.3**

### 속성 29: Agent 오류 처리

*모든* Agent 실행 오류에 대해, ZeroClaw Runtime은 해당 Agent를 안전하게 종료하고 오류 상태를 LangGraph Orchestrator에 보고해야 한다.

**검증: 요구사항 14.5**

### 속성 30: Agent 리소스 제한

*모든* Agent에 대해, 리소스 사용량이 설정된 한도를 초과하면 실행이 제한되어야 한다.

**검증: 요구사항 14.6**

### 속성 31: Agent 실행 로깅

*모든* Agent 실행에 대해, 실행 이력과 결과가 로그로 기록되어야 한다.

**검증: 요구사항 14.7**

### 속성 32: Docker 컨테이너 자동 재시작

*모든* Docker 컨테이너 비정상 종료에 대해, 해당 컨테이너가 자동으로 재시작되어야 한다.

**검증: 요구사항 15.6**

### 속성 33: Docker Volume 데이터 영속성

*모든* 데이터베이스 및 사용자 데이터에 대해, Docker Volume을 통해 컨테이너 재시작 후에도 보존되어야 한다.

**검증: 요구사항 15.7**

### 속성 34: 시스템 장애 자동 복구

*모든* 시스템 장애에 대해, 자동 복구가 시도되고 데이터 손실 없이 서비스가 재개되어야 한다.

**검증: 요구사항 16.7**

### 속성 35: API 응답 JSON 형식

*모든* API 응답에 대해, 응답 형식은 유효한 JSON이어야 한다.

**검증: 요구사항 16.9**

### 속성 36: API 응답 직렬화 라운드트립

*모든* 유효한 API 응답 객체에 대해, JSON으로 직렬화한 후 역직렬화하면 원본과 동일한 객체가 생성되어야 한다.

**검증: 요구사항 16.10**


## 결론

이 설계 문서는 SayknowMind v0.1.0의 전체 아키텍처, 컴포넌트, 데이터 모델, API, 보안, 배포 전략을 정의한다. 핵심 설계 원칙은 다음과 같다:

1. **로컬 우선 아키텍처**: Private Mode에서 모든 데이터를 100% 로컬에 저장하며, 외부 네트워크 접근을 완전히 차단하여 사용자 프라이버시를 최우선으로 보호한다.

2. **GraphRAG 기반 지식 탐색**: EdgeQuake Engine을 통해 Apache AGE 그래프 DB와 pgvector 벡터 DB를 결합한 하이브리드 검색을 제공하며, 6가지 Query Mode로 다양한 검색 요구사항을 충족한다.

3. **멀티 에이전트 오케스트레이션**: LangGraph와 ZeroClaw Runtime을 통해 안전하고 효율적인 Agent 실행 환경을 제공하며, 복잡한 질의를 자동으로 분해하고 처리한다.

4. **크로스 플랫폼 지원**: 웹, 데스크톱(Tauri), 모바일(Capacitor), MCP Server를 통해 다양한 플랫폼에서 일관된 사용자 경험을 제공한다.

5. **선택적 분산 공유**: Shared Mode에서 Lit Protocol v3, IPFS, Arweave를 활용하여 암호화된 지식 공유를 지원하며, 언제든지 권한을 철회할 수 있다.

6. **포괄적 테스트 전략**: 단위 테스트와 속성 기반 테스트를 결합하여 36개의 정확성 속성을 검증하며, 각 속성은 최소 100회 반복 테스트를 통해 신뢰성을 보장한다.

7. **보안 우선 설계**: AES-256 암호화, TLS 1.3, OWASP Top 10 방어, 봇 차단, 계정 잠금 등 다층 보안 체계를 구축한다.

8. **간편한 배포**: Docker Compose를 통한 1클릭 설치와 install.sh 스크립트로 사전 요구사항 확인 및 초기 설정을 자동화한다.

이 설계는 프로덕션 v0.1.0 출시를 위한 완전한 청사진을 제공하며, 모든 요구사항을 충족하고 확장 가능한 아키텍처를 제시한다. 다음 단계는 이 설계를 기반으로 구현 작업을 진행하고, 정의된 36개의 정확성 속성을 검증하는 테스트를 작성하는 것이다.

---

**문서 버전**: 1.0  
**작성일**: 2024-01-15  
**상태**: 설계 완료, 구현 대기
