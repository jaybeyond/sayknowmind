# Implementation Plan: SayknowMind v0.1.0

## Overview

This plan implements SayknowMind, an open-source Personal Agentic Second Brain platform, as a full-stack cross-platform system. Implementation is organized into 8 phases: project foundation, authentication & security, ingestion pipeline, knowledge exploration & chat, category management, cross-platform apps, MCP server & SDK, and deployment infrastructure. Each phase builds incrementally on the previous, with property-based tests validating the 36 correctness properties defined in the design document. All code and comments are written in English. The primary stack is TypeScript (Next.js 16 + React 19) with Rust services (EdgeQuake, ZeroClaw) and Python/Go for SDKs.

## Tasks

- [ ] 1. Project foundation and core infrastructure
  - [ ] 1.1 Initialize Next.js 16 + React 19 monorepo with Tailwind CSS and shadcn/ui
    - Create project root with `next@16`, `react@19`, `tailwindcss`, `shadcn/ui`
    - Apply square-ui/bookmarks template as base layout
    - Configure branding colors (Primary: #00E5FF, Accent: #FF2E63, Background: #0A0A0A)
    - Configure typography (Inter, Space Grotesk, Satoshi)
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [ ] 1.2 Set up PostgreSQL schema with pgvector and Apache AGE extensions
    - Create `init.sql` with all tables from design: users, documents, entities, categories, document_categories, vectors, graph_nodes, conversations, messages, shared_content
    - Enable pgvector extension and create vector indexes (ivfflat)
    - Configure Apache AGE graph schema
    - Create all indexes defined in the design document
    - _Requirements: 5.7, 16.3_

  - [ ] 1.3 Define core TypeScript interfaces and types
    - Create shared type definitions: User, Document, Entity, Category, Vector, GraphNode, GraphEdge, Conversation, Message, Citation, SharedContent, CategorySuggestion
    - Define API request/response interfaces for all endpoints (Auth, Ingestion, Search, Chat, Category, MCP)
    - Define ErrorCode enum and ErrorResponse interface
    - _Requirements: 16.9_

  - [ ]* 1.4 Write property test for API response JSON format (Property 35)
    - **Property 35: API response JSON format**
    - Generate arbitrary API response objects and verify they serialize to valid JSON
    - **Validates: Requirements 16.9**

  - [ ]* 1.5 Write property test for API response serialization round-trip (Property 36)
    - **Property 36: API response serialization round-trip**
    - Generate arbitrary API response objects, serialize to JSON, deserialize, and verify equality with original
    - **Validates: Requirements 16.10**

  - [ ] 1.6 Set up i18n with Korean and English support
    - Implement i18n provider using next-intl or similar library
    - Create translation files for ko and en locales
    - Implement language switcher component with client-side locale change (no page reload)
    - _Requirements: 1.7, 1.8_

  - [ ]* 1.7 Write property test for language switching (Property 1)
    - **Property 1: Language switching UI text change**
    - For arbitrary UI text keys, verify that switching locale changes the displayed text without page reload
    - **Validates: Requirements 1.8**

- [ ] 2. Authentication and security layer
  - [ ] 2.1 Implement better-auth authentication module
    - Configure better-auth with email/password signup and login
    - Implement JWT token issuance (HS256, 24h expiry) and refresh token (30d)
    - Implement session token management with automatic renewal on expiry
    - Implement account lockout: 5 consecutive failures → 15 minute lock
    - Create API routes: POST /api/auth/signup, POST /api/auth/login, POST /api/auth/logout
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_

  - [ ] 2.2 Implement authentication middleware for protected routes
    - Create middleware that validates JWT tokens on all protected API routes
    - Redirect unauthenticated users to login page
    - Return 401 Unauthorized for API requests without valid tokens
    - _Requirements: 2.4_

  - [ ]* 2.3 Write property test for unauthenticated access blocking (Property 2)
    - **Property 2: Unauthenticated access blocking**
    - For arbitrary protected route paths, verify that requests without valid auth tokens are blocked and redirected
    - **Validates: Requirements 2.4**

  - [ ]* 2.4 Write property test for session token auto-renewal (Property 3)
    - **Property 3: Session token auto-renewal**
    - For arbitrary session tokens near expiry, verify automatic renewal occurs and failed renewal triggers re-authentication
    - **Validates: Requirements 2.6**

  - [ ] 2.5 Implement AntiBot module with tiagozip/cap integration
    - Integrate tiagozip/cap self-hosted PoW CAPTCHA
    - Implement bot traffic pattern analysis (User-Agent, request rate, intervals)
    - Implement IP-based rate limiting (100 req/min) and user-based rate limiting (1000 req/hour)
    - Create blocking log entries with reason and timestamp
    - _Requirements: 3.1, 3.2, 3.4_

  - [ ]* 2.6 Write property test for bot traffic blocking and logging (Property 4)
    - **Property 4: Bot traffic blocking and logging**
    - For arbitrary bot-pattern requests, verify they are blocked and log entries contain reason + timestamp
    - **Validates: Requirements 3.2, 3.4**

  - [ ] 2.7 Implement data encryption layer (AES-256-GCM)
    - Implement AES-256-GCM encryption for stored data
    - Implement per-user encryption key management
    - Configure TLS 1.3 and HSTS headers
    - Apply OWASP Top 10 defenses: input validation, CSP headers, prepared statements, JSON schema validation
    - _Requirements: 16.4, 16.5_

  - [ ]* 2.8 Write property test for data encryption (Property 18)
    - **Property 18: Private Mode data local storage and encryption**
    - For arbitrary user data, verify it is encrypted with AES-256 before storage and stored only locally in Private Mode
    - **Validates: Requirements 10.1, 16.4**

- [ ] 3. Checkpoint - Foundation and security
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Ingestion Pipeline (Phase A)
  - [ ] 4.1 Implement file ingestion endpoint with drag-and-drop support
    - Create POST /api/ingest/file endpoint (multipart/form-data)
    - Implement file parsing for common formats (PDF, TXT, MD, HTML, DOCX)
    - Store parsed content as Document in PostgreSQL
    - Return IngestFileResponse with documentId, title, summary, entities, suggestedCategories
    - _Requirements: 4.1_

  - [ ] 4.2 Implement URL ingestion with crawl4ai and vakra-dev/reader
    - Create POST /api/ingest/url endpoint
    - Integrate crawl4ai for web page crawling
    - Integrate vakra-dev/reader for content extraction
    - Integrate tf-playwright-stealth for JavaScript-rendered pages
    - Integrate Scrapling for structured data extraction
    - _Requirements: 4.2, 4.7, 4.8_

  - [ ] 4.3 Implement post-ingestion AI processing pipeline
    - Call sayknow-ai-server (port 4000) for automatic summary generation on Document save
    - Call sayknow-ai-server for Entity extraction (person, organization, location, concept, keyword)
    - Implement dynamic category assignment based on content analysis
    - Create GET /api/ingest/status/:jobId for async job tracking
    - _Requirements: 4.4, 4.5, 4.6_

  - [ ]* 4.4 Write property test for Document ingestion completeness (Property 5)
    - **Property 5: Document ingestion completeness**
    - For arbitrary valid inputs (file/URL), verify that ingestion produces a Document with summary, extracted entities, and assigned categories
    - **Validates: Requirements 4.1, 4.2, 4.4, 4.5, 4.6**

  - [ ] 4.5 Implement ingestion error handling
    - Log detailed error information on parsing failures
    - Display failure notification to user with error details
    - Implement retry mechanism for transient failures
    - _Requirements: 4.9_

  - [ ]* 4.6 Write property test for ingestion error handling (Property 6)
    - **Property 6: Ingestion error handling**
    - For arbitrary malformed inputs, verify error details are logged and user receives failure notification
    - **Validates: Requirements 4.9**

  - [ ] 4.7 Implement browser extension ingestion endpoint
    - Create endpoint for browser extension page save requests
    - Process incoming page content through the same ingestion pipeline
    - _Requirements: 4.3_

  - [ ] 4.8 Implement multi-language content support in ingestion
    - Support Korean, English, Japanese, Chinese content ingestion and indexing
    - Configure language detection in the ingestion pipeline
    - _Requirements: 16.6_

  - [ ]* 4.9 Write property test for multi-language content (Property related to 16.6)
    - Generate arbitrary multi-language content (ko, en, ja, zh) and verify successful ingestion and searchability
    - **Validates: Requirements 16.6**

- [ ] 5. Checkpoint - Ingestion pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Knowledge exploration and chat (Phase B)
  - [ ] 6.1 Implement EdgeQuake Engine integration with 6 Query Modes
    - Create EdgeQuake client service connecting to Rust service on port 8080
    - Implement all 6 Query Modes: Local, Global, Hybrid, Drift, Mix, Naive
    - Implement hybrid search combining Apache AGE graph queries and pgvector vector search
    - Create POST /api/search endpoint with SearchRequest/SearchResponse interfaces
    - _Requirements: 5.1, 5.2, 5.7_

  - [ ] 6.2 Implement Citation generation in search results
    - Attach Citation objects (documentId, title, url, excerpt, relevanceScore) to each search result
    - Ensure every search result includes at least one Citation to the source Document
    - _Requirements: 5.4_

  - [ ]* 6.3 Write property test for search results with Citation (Property 7)
    - **Property 7: Search results Citation inclusion**
    - For arbitrary search queries against seeded data, verify every result item contains at least one Citation
    - **Validates: Requirements 5.2, 5.4**

  - [ ] 6.4 Implement chat API with streaming responses
    - Create POST /api/chat endpoint with ChatRequest/ChatResponse interfaces
    - Implement simple mode: direct answer generation via sayknow-ai-server
    - Implement Server-Sent Events (SSE) for real-time streaming responses
    - Integrate Vercel AI SDK for streaming UI rendering
    - _Requirements: 5.6_

  - [ ] 6.5 Implement Agentic Query with LangGraph orchestration
    - Integrate LangGraph for multi-step reasoning on complex queries
    - Implement task decomposition: break complex queries into sub-tasks
    - Assign sub-tasks to appropriate Agents via ZeroClaw Runtime (port 8081)
    - Return AgentStep array in ChatResponse for agentic mode
    - _Requirements: 5.5, 14.2, 14.3_

  - [ ]* 6.6 Write property test for Agent task decomposition (Property 28)
    - **Property 28: Agent complex query decomposition**
    - For arbitrary complex queries, verify LangGraph decomposes them into sub-tasks and assigns to Agents
    - **Validates: Requirements 14.3**

  - [ ] 6.7 Implement Agent error handling and resource monitoring
    - Implement safe Agent termination on errors via ZeroClaw Runtime
    - Report error state to LangGraph Orchestrator on Agent failure
    - Monitor Agent CPU/memory usage and enforce resource limits
    - Log Agent execution history and results
    - _Requirements: 14.4, 14.5, 14.6, 14.7_

  - [ ]* 6.8 Write property test for Agent error handling (Property 29)
    - **Property 29: Agent error handling**
    - For arbitrary Agent execution errors, verify safe termination and error state reporting to orchestrator
    - **Validates: Requirements 14.5**

  - [ ]* 6.9 Write property test for Agent resource limits (Property 30)
    - **Property 30: Agent resource limits**
    - For arbitrary Agent resource usage exceeding limits, verify execution is restricted
    - **Validates: Requirements 14.6**

  - [ ]* 6.10 Write property test for Agent execution logging (Property 31)
    - **Property 31: Agent execution logging**
    - For arbitrary Agent executions, verify execution history and results are logged
    - **Validates: Requirements 14.7**

  - [ ] 6.11 Implement RAG dashboard with Sigma.js graph visualization
    - Create React 19 RAG dashboard component
    - Integrate Sigma.js for interactive knowledge graph visualization
    - Implement node click → show Entity details + connected Document list
    - Implement search result graph highlighting
    - Implement zoom, panning, and filtering interactions
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 6.12 Write property test for graph node detail display (Property 8)
    - **Property 8: Graph node detail display**
    - For arbitrary graph nodes, verify clicking shows Entity details and connected Document list
    - **Validates: Requirements 6.3**

  - [ ] 6.13 Implement real-time Agent execution status display
    - Show Agent execution state and progress in real-time on the Frontend
    - Display step-by-step progress for agentic queries
    - _Requirements: 14.8_

- [ ] 7. Checkpoint - Knowledge exploration and chat
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Category management (Phase C)
  - [ ] 8.1 Implement Category CRUD API
    - Create GET /api/categories, POST /api/categories, PUT /api/categories/:id, DELETE /api/categories/:id
    - Implement POST /api/categories/merge for category merging
    - Implement tree path management (depth, path fields)
    - Ensure category name changes propagate to all referencing Documents
    - _Requirements: 7.3, 7.5, 7.10_

  - [ ] 8.2 Implement Category tree UI component
    - Create tree structure UI displaying category hierarchy
    - Implement drag-and-drop to move categories between parents
    - Update hierarchy (depth, path) on category move
    - _Requirements: 7.1, 7.4_

  - [ ] 8.3 Implement Category graph UI with React Flow
    - Create React Flow-based graph UI visualizing category relationships
    - Synchronize category creation/updates between tree and graph UI simultaneously
    - _Requirements: 7.2, 7.3_

  - [ ]* 8.4 Write property test for category creation UI sync (Property 9)
    - **Property 9: Category creation UI synchronization**
    - For arbitrary category creations, verify the category appears in both tree UI and graph UI simultaneously
    - **Validates: Requirements 7.3**

  - [ ]* 8.5 Write property test for category move hierarchy update (Property 10)
    - **Property 10: Category move hierarchy update**
    - For arbitrary category drag-and-drop moves, verify hierarchy (depth, path) is correctly updated
    - **Validates: Requirements 7.4**

  - [ ]* 8.6 Write property test for category rename reference update (Property 11)
    - **Property 11: Category rename reference update**
    - For arbitrary category name edits, verify all referencing Documents have updated category info
    - **Validates: Requirements 7.5**

  - [ ] 8.7 Implement Agent-based category suggestion
    - On new Document ingestion, call Agent to suggest category placement
    - Return suggestion with reason and confidence score (0.0-1.0)
    - Implement suggestion approval: assign Document to suggested category
    - Implement suggestion rejection: store rejection feedback as learning data
    - _Requirements: 7.6, 7.7, 7.8, 7.9_

  - [ ]* 8.8 Write property test for category auto-suggestion (Property 12)
    - **Property 12: Document ingestion category auto-suggestion**
    - For arbitrary new Documents, verify Agent provides category suggestion with reason and confidence score
    - **Validates: Requirements 7.6, 7.7**

  - [ ]* 8.9 Write property test for category suggestion approval/rejection (Property 13)
    - **Property 13: Category suggestion approval/rejection handling**
    - For arbitrary suggestion approvals, verify Document is assigned to category; for rejections, verify feedback is stored
    - **Validates: Requirements 7.8, 7.9**

- [ ] 9. Checkpoint - Category management
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Private Mode and Shared Mode
  - [ ] 10.1 Implement Private Mode network isolation
    - Block all outbound network connections when Private Mode is active
    - Allow only Tailscale and Syncthing connections
    - Block DNS queries to external servers
    - Block all telemetry data collection and transmission
    - _Requirements: 10.3, 10.8_

  - [ ]* 10.2 Write property test for Private Mode network blocking (Property 19)
    - **Property 19: Private Mode network blocking**
    - For arbitrary external URLs, verify all outbound connections are blocked in Private Mode
    - **Validates: Requirements 10.3**

  - [ ]* 10.3 Write property test for Private Mode telemetry blocking (Property 21)
    - **Property 21: Private Mode telemetry blocking**
    - Verify no telemetry data is collected or transmitted while Private Mode is active
    - **Validates: Requirements 10.8**

  - [ ] 10.4 Implement Private Mode local data storage
    - Ensure all user data is stored only in local storage (Docker volumes)
    - Configure local LLM integration (Ollama) for AI features without external API calls
    - _Requirements: 10.1, 10.7_

  - [ ] 10.5 Implement Tailscale and Syncthing integration for device sync
    - Configure Tailscale for secure inter-device networking
    - Configure Syncthing for data synchronization between devices
    - Implement sync conflict detection and manual resolution UI
    - _Requirements: 10.4, 10.5, 10.6_

  - [ ]* 10.6 Write property test for sync conflict handling (Property 20)
    - **Property 20: Private Mode sync conflict handling**
    - For arbitrary sync conflicts, verify conflict items are displayed to user with manual resolution options
    - **Validates: Requirements 10.6**

  - [ ] 10.7 Implement Shared Mode with Lit Protocol v3
    - Integrate Lit Protocol v3 for content access control
    - Implement Document encryption before upload to distributed network
    - Integrate IPFS for distributed content storage
    - Integrate Arweave for permanent storage
    - Integrate Ceramic Network for shared metadata management
    - Create shared_content records with access conditions (wallet, token, NFT, public)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 10.8 Write property test for Shared Mode document encryption and upload (Property 22)
    - **Property 22: Shared Mode Document encryption and upload**
    - For arbitrary Documents shared, verify they are encrypted before upload to distributed network
    - **Validates: Requirements 11.5**

  - [ ] 10.9 Implement Shared Mode access control and revocation
    - Create share link generation UI with access condition configuration (wallet address, token holding)
    - Implement permission revocation via Lit Protocol (immediate invalidation)
    - Block unauthorized access attempts with permission-denied message
    - _Requirements: 11.6, 11.7, 11.8_

  - [ ]* 10.10 Write property test for Shared Mode permission revocation (Property 23)
    - **Property 23: Shared Mode permission revocation**
    - For arbitrary share revocations, verify access conditions are immediately invalidated
    - **Validates: Requirements 11.7**

  - [ ]* 10.11 Write property test for Shared Mode unauthorized access blocking (Property 24)
    - **Property 24: Shared Mode unauthorized access blocking**
    - For arbitrary unauthorized access attempts, verify access is blocked with permission-denied message
    - **Validates: Requirements 11.8**

- [ ] 11. Checkpoint - Private Mode and Shared Mode
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Desktop and Mobile apps
  - [ ] 12.1 Set up Tauri desktop application
    - Configure Tauri to package the Next.js web app as desktop app
    - Configure builds for Windows, macOS, Linux
    - Implement system tray icon for background execution
    - Implement auto-start of local services on app launch
    - Implement global shortcut for quick search window
    - Implement auto-update with new version notification
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ] 12.2 Implement Desktop App offline functionality
    - Enable search and exploration using locally stored data when offline
    - Cache essential data for offline access
    - _Requirements: 12.7_

  - [ ]* 12.3 Write property test for Desktop App offline functionality (Property 25)
    - **Property 25: Desktop App offline functionality**
    - For arbitrary offline states, verify search and exploration work using local data
    - **Validates: Requirements 12.7**

  - [ ] 12.4 Set up Capacitor mobile application
    - Configure Capacitor for Android and iOS builds
    - Implement responsive UI optimized for mobile screen sizes
    - Implement share intent receiver to forward content to Ingestion Pipeline
    - Implement push notifications for Agent suggestions and ingestion completion
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.7_

  - [ ]* 12.5 Write property test for Mobile App share intent handling (Property 26)
    - **Property 26: Mobile App share intent handling**
    - For arbitrary share intents from mobile browser, verify they are received and forwarded to Ingestion Pipeline
    - **Validates: Requirements 13.4**

  - [ ] 12.6 Implement Mobile App offline mode and sync
    - Support offline search using cached data
    - Auto-sync offline-collected data when network connection is restored
    - _Requirements: 13.5, 13.6_

  - [ ]* 12.7 Write property test for Mobile App network recovery sync (Property 27)
    - **Property 27: Mobile App network recovery sync**
    - For arbitrary network recovery events, verify offline-collected data is automatically synced
    - **Validates: Requirements 13.6**

- [ ] 13. Checkpoint - Desktop and Mobile apps
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. MCP Server and SDK (Phase D)
  - [ ] 14.1 Implement MCP Server with Model Context Protocol
    - Create MCP Server on port 8082 compliant with Model Context Protocol standard
    - Implement JSON-RPC 2.0 request/response handling
    - Implement MCP methods: sayknowmind.search, sayknowmind.ingest, sayknowmind.categories
    - Implement per-request auth token verification
    - Implement auto-reconnect (up to 3 retries) with error state return on failure
    - _Requirements: 8.1, 8.2, 8.5, 8.7_

  - [ ] 14.2 Wire MCP Server to EdgeQuake and Ingestion Pipeline
    - Connect sayknowmind.search to EdgeQuake Engine for search execution
    - Connect sayknowmind.ingest to Ingestion Pipeline for content collection
    - Ensure compatibility with Claude Desktop, ChatGPT Plugin, Cursor, Windsurf
    - _Requirements: 8.3, 8.4, 8.6_

  - [ ]* 14.3 Write property test for MCP search request handling (Property 14)
    - **Property 14: MCP search request handling**
    - For arbitrary MCP search requests, verify EdgeQuake Engine performs search and returns results
    - **Validates: Requirements 8.3**

  - [ ]* 14.4 Write property test for MCP ingest request handling (Property 15)
    - **Property 15: MCP ingest request handling**
    - For arbitrary MCP ingest requests, verify Ingestion Pipeline collects the content
    - **Validates: Requirements 8.4**

  - [ ]* 14.5 Write property test for MCP auth token verification (Property 16)
    - **Property 16: MCP auth token verification**
    - For arbitrary MCP requests with valid/invalid tokens, verify valid tokens are processed and invalid tokens are blocked
    - **Validates: Requirements 8.5**

  - [ ] 14.6 Implement TypeScript SDK (@sayknowmind/sdk)
    - Create npm package with SayknowMindClient class
    - Implement methods: ingestUrl, ingestFile, search, chat, chatStream, getCategories, createCategory
    - Implement request/response serialization and deserialization
    - Implement idiomatic error handling with Promise rejection
    - _Requirements: 9.1, 9.2, 9.4, 9.6_

  - [ ] 14.7 Implement Python SDK (sayknowmind)
    - Create pip package with SayknowMindClient class
    - Implement methods: ingest_url, ingest_file, search, chat, get_categories, create_category
    - Implement request/response serialization and deserialization
    - Implement idiomatic error handling with exceptions
    - _Requirements: 9.1, 9.2, 9.4, 9.6_

  - [ ] 14.8 Implement Go SDK (github.com/sayknowmind/go-sdk)
    - Create Go module with Client struct and functional options pattern
    - Implement methods: IngestURL, IngestFile, Search, Chat, GetCategories, CreateCategory
    - Implement request/response serialization and deserialization
    - Implement idiomatic error handling with error return values
    - _Requirements: 9.1, 9.2, 9.4, 9.6_

  - [ ]* 14.9 Write property test for SDK serialization round-trip (Property 17)
    - **Property 17: SDK serialization round-trip**
    - For arbitrary valid API request objects in each SDK language, verify serialize → deserialize produces identical object
    - Use fast-check for TypeScript, Hypothesis for Python, gopter for Go
    - **Validates: Requirements 9.5**

- [ ] 15. Checkpoint - MCP Server and SDK
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Docker deployment infrastructure
  - [ ] 16.1 Create Docker Compose configuration
    - Create docker-compose.yml with all services: frontend (3000), ai-server (4000), edgequake (8080), zeroclaw (8081), mcp-server (8082), postgres (5432)
    - Configure Docker volumes: db_data, model_cache, user_data
    - Configure restart policy: unless-stopped for all services
    - Configure healthchecks for each service
    - Configure resource limits (ai-server: 8G memory limit, 4G reservation)
    - _Requirements: 15.1, 15.5, 15.6, 15.7, 15.8_

  - [ ]* 16.2 Write property test for Docker container auto-restart (Property 32)
    - **Property 32: Docker container auto-restart**
    - Verify docker-compose.yml has restart: unless-stopped for all services
    - **Validates: Requirements 15.6**

  - [ ]* 16.3 Write property test for Docker Volume data persistence (Property 33)
    - **Property 33: Docker Volume data persistence**
    - For arbitrary data stored in volumes, verify data persists across container restarts
    - **Validates: Requirements 15.7**

  - [ ] 16.4 Create install.sh script
    - Check Docker and Docker Compose installation, display guidance if missing
    - Generate .env file with default configuration and random AUTH_SECRET
    - Support environment variable-based customization
    - Execute docker-compose up -d
    - _Requirements: 15.2, 15.3, 15.4_

  - [ ] 16.5 Implement system fault recovery
    - Configure automatic recovery attempts on system failures
    - Ensure data integrity (no data loss) during recovery
    - Implement database connection auto-reconnect (up to 5 retries)
    - Implement query timeout (10s) with automatic rollback
    - _Requirements: 16.7_

  - [ ]* 16.6 Write property test for system fault recovery (Property 34)
    - **Property 34: System fault auto-recovery**
    - For arbitrary simulated system faults, verify automatic recovery is attempted and service resumes without data loss
    - **Validates: Requirements 16.7**

- [ ] 17. Final checkpoint - Full system integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at each phase boundary
- Property tests validate the 36 correctness properties from the design document using fast-check (TypeScript), Hypothesis (Python), proptest (Rust), and gopter (Go)
- The sayknow-ai-server (port 4000) is an existing NestJS service — tasks integrate with it, not rebuild it
- All code and comments must be written in English only
