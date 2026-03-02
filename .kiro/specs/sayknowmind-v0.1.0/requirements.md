# Requirements Document

## 소개

SayknowMind는 오픈소스(MIT) 개인 에이전틱 세컨드 브레인 플랫폼이다. "Everything you say, we know, and mind forever." 슬로건 아래, 사용자가 수집한 모든 지식을 로컬 우선(Private Mode)으로 저장·검색·활용할 수 있는 풀스택 크로스 플랫폼 시스템이다. GraphRAG 기반 지식 탐색, 멀티 에이전트 오케스트레이션, MCP Server를 통한 외부 AI 플랫폼 연동, 선택적 분산 공유(Shared Mode)를 제공한다. 프로덕션 v0.1.0 출시를 목표로 한다.

## 용어집

- **SayknowMind_System**: SayknowMind 플랫폼 전체를 지칭하는 시스템 명칭
- **Frontend**: Next.js 16 + React 19 기반 웹 애플리케이션 UI 계층
- **EdgeQuake_Engine**: Rust 기반 GraphRAG 엔진 (v0.5.1). Apache AGE(그래프 DB) + pgvector(벡터 DB)를 내장하며, 6가지 Query Mode를 제공
- **ZeroClaw_Runtime**: Rust 기반 Agent Runtime (v0.1.7). 안전성이 검증된 기능만 사용
- **LangGraph_Orchestrator**: Stateful 멀티 에이전트 오케스트레이션 프레임워크
- **Ingestion_Pipeline**: crawl4ai, vakra-dev/reader, Scrapling, tf-playwright-stealth를 조합한 데이터 수집 파이프라인
- **Private_Mode**: 모든 데이터를 100% 로컬에 저장하며 외부 네트워크 접근을 차단하는 기본 운영 모드
- **Shared_Mode**: Lit Protocol v3, IPFS, Arweave, Ceramic Network를 활용한 선택적 분산 공유 모드
- **MCP_Server**: Model Context Protocol 서버. 외부 AI 플랫폼에서 @SayknowMind Skill로 호출 가능한 인터페이스
- **Auth_Module**: better-auth 기반 인증/인가 모듈
- **Desktop_App**: Tauri로 패키징된 데스크톱 애플리케이션
- **Mobile_App**: Tauri 또는 Capacitor로 빌드된 Android/iOS 모바일 애플리케이션
- **SDK**: Python, TypeScript, Go 언어로 제공되는 소프트웨어 개발 키트
- **AntiBot_Module**: 봇 트래픽을 감지하고 차단하는 보안 모듈
- **Category_Manager**: 트리 + 그래프 UI를 통한 지식 카테고리 관리 컴포넌트
- **Document**: SayknowMind_System에 수집·저장되는 개별 지식 단위 (웹 페이지, 파일, 텍스트 등)
- **Entity**: Document에서 자동 추출된 개체 (인물, 조직, 개념, 키워드 등)
- **Citation**: 검색 결과에서 원본 Document 출처를 명시하는 참조 정보
- **Query_Mode**: EdgeQuake_Engine이 제공하는 6가지 검색 모드 (Local, Global, Hybrid, Drift, Mix, Naive)

## 요구사항

### 요구사항 1: 프론트엔드 웹 애플리케이션

**사용자 스토리:** 지식 워커로서, 직관적이고 반응형인 웹 인터페이스를 통해 지식을 관리하고 탐색하고 싶다. 이를 통해 효율적으로 세컨드 브레인을 활용할 수 있다.

#### 인수 조건

1. THE Frontend SHALL 렌더링에 Next.js 16과 React 19를 사용한다
2. THE Frontend SHALL square-ui/bookmarks 템플릿을 기반 레이아웃으로 적용한다
3. THE Frontend SHALL UI 컴포넌트에 shadcn/ui와 Tailwind CSS를 사용한다
4. THE Frontend SHALL Vercel AI SDK를 통해 AI 기능과 통합한다
5. THE Frontend SHALL 브랜딩 컬러 시스템을 적용한다 (Primary: #00E5FF, Accent: #FF2E63, Background: #0A0A0A)
6. THE Frontend SHALL 타이포그래피에 Inter, Space Grotesk, Satoshi 폰트를 사용한다
7. THE Frontend SHALL 한국어와 영어를 기본 지원 언어로 제공한다
8. WHEN 사용자가 언어를 전환하면, THE Frontend SHALL 페이지 새로고침 없이 UI 텍스트를 해당 언어로 변경한다

### 요구사항 2: 인증 시스템

**사용자 스토리:** 사용자로서, 안전하게 로그인하고 회원가입하여 개인 지식 데이터를 보호하고 싶다.

#### 인수 조건

1. THE Auth_Module SHALL better-auth 라이브러리를 사용하여 인증 기능을 구현한다
2. THE Auth_Module SHALL 이메일/비밀번호 기반 회원가입 기능을 제공한다
3. THE Auth_Module SHALL 이메일/비밀번호 기반 로그인 기능을 제공한다
4. WHEN 인증되지 않은 사용자가 보호된 리소스에 접근하면, THE Auth_Module SHALL 해당 요청을 차단하고 로그인 페이지로 리다이렉트한다
5. WHEN 로그인에 5회 연속 실패하면, THE Auth_Module SHALL 해당 계정을 15분간 잠금 처리한다
6. THE Auth_Module SHALL 세션 토큰을 안전하게 관리하고 만료 시 자동으로 갱신한다

### 요구사항 3: 봇 감지 및 차단

**사용자 스토리:** 시스템 관리자로서, 자동화된 봇 트래픽을 감지하고 차단하여 시스템 리소스를 보호하고 싶다.

#### 인수 조건

1. THE AntiBot_Module SHALL 수신되는 요청에서 봇 트래픽 패턴을 분석한다
2. WHEN 봇 트래픽이 감지되면, THE AntiBot_Module SHALL 해당 요청을 차단하고 로그에 기록한다
3. THE AntiBot_Module SHALL 정상 사용자의 요청을 봇으로 오탐하는 비율을 1% 미만으로 유지한다
4. WHEN 차단된 요청이 발생하면, THE AntiBot_Module SHALL 차단 사유와 타임스탬프를 포함한 로그 항목을 생성한다

### 요구사항 4: 자동 Ingestion (Phase A)

**사용자 스토리:** 지식 워커로서, 다양한 소스에서 콘텐츠를 쉽게 수집하고 자동으로 정리되길 원한다. 이를 통해 수동 분류 작업 없이 지식을 축적할 수 있다.

#### 인수 조건

1. WHEN 사용자가 파일을 대시보드에 드래그 앤 드롭하면, THE Ingestion_Pipeline SHALL 해당 파일을 파싱하여 Document로 저장한다
2. WHEN 사용자가 URL을 붙여넣으면, THE Ingestion_Pipeline SHALL crawl4ai와 vakra-dev/reader를 사용하여 해당 웹 페이지 콘텐츠를 수집한다
3. WHEN 사용자가 브라우저 확장 프로그램을 통해 페이지를 저장하면, THE Ingestion_Pipeline SHALL 해당 페이지 콘텐츠를 수집하여 Document로 저장한다
4. WHEN Document가 저장되면, THE Ingestion_Pipeline SHALL 해당 Document의 자동 요약을 생성한다
5. WHEN Document가 저장되면, THE Ingestion_Pipeline SHALL 해당 Document에서 Entity를 자동 추출한다
6. WHEN Document가 저장되면, THE Ingestion_Pipeline SHALL 콘텐츠 분석 결과를 기반으로 동적 카테고리를 자동 할당한다
7. THE Ingestion_Pipeline SHALL tf-playwright-stealth를 사용하여 JavaScript 렌더링이 필요한 웹 페이지를 수집한다
8. THE Ingestion_Pipeline SHALL Scrapling을 사용하여 구조화된 데이터를 추출한다
9. IF Ingestion 과정에서 파싱 오류가 발생하면, THEN THE Ingestion_Pipeline SHALL 오류 상세 정보를 로그에 기록하고 사용자에게 실패 알림을 표시한다

### 요구사항 5: 지식 탐색 및 채팅 (Phase B)

**사용자 스토리:** 사용자로서, 자연어로 질문하여 저장된 지식을 탐색하고 정확한 출처와 함께 답변을 받고 싶다.

#### 인수 조건

1. THE EdgeQuake_Engine SHALL 6가지 Query Mode(Local, Global, Hybrid, Drift, Mix, Naive)를 제공한다
2. WHEN 사용자가 자연어 검색 쿼리를 입력하면, THE EdgeQuake_Engine SHALL 관련 Document를 검색하여 결과를 반환한다
3. WHEN 검색 쿼리가 실행되면, THE EdgeQuake_Engine SHALL 200ms 이내에 검색 결과를 반환한다
4. WHEN 검색 결과가 반환되면, THE SayknowMind_System SHALL 각 결과에 원본 Document의 Citation을 포함한다
5. THE SayknowMind_System SHALL Agentic Query 기능을 제공하여 복잡한 질문에 대해 멀티 스텝 추론을 수행한다
6. WHEN 채팅 응답이 생성되면, THE Frontend SHALL 실시간 스트리밍 방식으로 응답 텍스트를 표시한다
7. THE EdgeQuake_Engine SHALL Apache AGE 그래프 DB와 pgvector 벡터 DB를 결합한 하이브리드 검색을 수행한다

### 요구사항 6: RAG 대시보드 및 그래프 시각화

**사용자 스토리:** 사용자로서, 지식 그래프를 시각적으로 탐색하여 Entity 간의 관계를 직관적으로 파악하고 싶다.

#### 인수 조건

1. THE Frontend SHALL React 19 기반 RAG 대시보드를 제공한다
2. THE Frontend SHALL Sigma.js를 사용하여 지식 그래프를 인터랙티브하게 시각화한다
3. WHEN 사용자가 그래프의 노드를 클릭하면, THE Frontend SHALL 해당 Entity의 상세 정보와 연결된 Document 목록을 표시한다
4. WHEN 사용자가 검색을 수행하면, THE Frontend SHALL 검색 결과와 관련된 그래프 영역을 하이라이트한다
5. THE Frontend SHALL 그래프에서 줌, 패닝, 필터링 인터랙션을 지원한다


### 요구사항 7: 카테고리 관리 (Phase C)

**사용자 스토리:** 지식 워커로서, 트리와 그래프 UI를 통해 지식 카테고리를 직관적으로 관리하고, Agent의 자동 제안을 받아 분류 체계를 효율적으로 구축하고 싶다.

#### 인수 조건

1. THE Category_Manager SHALL 트리 구조 UI를 제공하여 카테고리 계층을 표시한다
2. THE Category_Manager SHALL React Flow 기반 그래프 UI를 제공하여 카테고리 간 관계를 시각화한다
3. WHEN 사용자가 카테고리를 생성하면, THE Category_Manager SHALL 해당 카테고리를 트리와 그래프 UI에 동시에 반영한다
4. WHEN 사용자가 카테고리를 드래그 앤 드롭으로 이동하면, THE Category_Manager SHALL 카테고리 계층 구조를 업데이트한다
5. WHEN 사용자가 카테고리 이름을 편집하면, THE Category_Manager SHALL 해당 카테고리를 참조하는 모든 Document의 카테고리 정보를 갱신한다
6. WHEN 새로운 Document가 수집되면, THE Category_Manager SHALL Agent를 통해 적합한 카테고리 배치를 자동으로 제안한다
7. WHEN Agent가 카테고리 제안을 생성하면, THE Category_Manager SHALL 제안 사유와 신뢰도 점수를 함께 표시한다
8. WHEN 사용자가 Agent의 카테고리 제안을 승인하면, THE Category_Manager SHALL 해당 Document를 제안된 카테고리에 할당한다
9. WHEN 사용자가 Agent의 카테고리 제안을 거부하면, THE Category_Manager SHALL 거부 피드백을 학습 데이터로 저장한다
10. THE Category_Manager SHALL 카테고리 병합 기능을 제공하여 중복 카테고리를 통합한다

### 요구사항 8: Cross-Platform Skill / MCP Server (Phase D)

**사용자 스토리:** 개발자로서, 외부 AI 플랫폼(Claude, ChatGPT, Cursor 등)에서 @SayknowMind를 호출하여 저장된 지식에 접근하고 싶다.

#### 인수 조건

1. THE MCP_Server SHALL Model Context Protocol 표준을 준수하는 서버를 제공한다
2. THE MCP_Server SHALL 외부 AI 플랫폼에서 @SayknowMind Skill로 호출 가능한 엔드포인트를 노출한다
3. WHEN 외부 AI 플랫폼에서 검색 요청이 수신되면, THE MCP_Server SHALL EdgeQuake_Engine을 통해 검색을 수행하고 결과를 반환한다
4. WHEN 외부 AI 플랫폼에서 Document 수집 요청이 수신되면, THE MCP_Server SHALL Ingestion_Pipeline을 통해 해당 콘텐츠를 수집한다
5. THE MCP_Server SHALL 요청별 인증 토큰을 검증하여 권한이 없는 접근을 차단한다
6. THE MCP_Server SHALL Claude Desktop, ChatGPT Plugin, Cursor, Windsurf 플랫폼과의 연동을 지원한다
7. WHEN MCP_Server에 연결 오류가 발생하면, THE MCP_Server SHALL 자동 재연결을 3회까지 시도하고 실패 시 오류 상태를 클라이언트에 반환한다

### 요구사항 9: SDK

**사용자 스토리:** 개발자로서, Python, TypeScript, Go SDK를 사용하여 SayknowMind 기능을 프로그래밍 방식으로 통합하고 싶다.

#### 인수 조건

1. THE SDK SHALL Python, TypeScript, Go 세 가지 언어로 클라이언트 라이브러리를 제공한다
2. THE SDK SHALL Document 수집, 검색, 카테고리 관리 API를 래핑한 함수를 제공한다
3. THE SDK SHALL 각 언어별 패키지 매니저(pip, npm, go modules)를 통한 설치를 지원한다
4. THE SDK SHALL API 요청/응답 직렬화 및 역직렬화를 수행한다
5. FOR ALL 유효한 API 요청 객체에 대해, SDK로 직렬화한 후 역직렬화하면 원본과 동일한 객체를 생성한다 (라운드트립 속성)
6. THE SDK SHALL 각 언어별 관용적 에러 핸들링 패턴을 따른다 (Python: 예외, TypeScript: Promise rejection, Go: error 반환)
7. THE SDK SHALL API 레퍼런스 문서와 사용 예제를 포함한다

### 요구사항 10: Private Mode

**사용자 스토리:** 프라이버시를 중시하는 사용자로서, 모든 데이터를 100% 로컬에 저장하고 외부 네트워크 접근을 완전히 차단하여 개인 지식을 안전하게 보호하고 싶다.

#### 인수 조건

1. THE Private_Mode SHALL 모든 사용자 데이터를 로컬 스토리지에만 저장한다
2. THE Private_Mode SHALL Docker Compose를 사용한 1클릭 설치를 지원한다
3. WHEN Private_Mode가 활성화되면, THE SayknowMind_System SHALL 외부 네트워크로의 모든 아웃바운드 연결을 차단한다
4. THE Private_Mode SHALL Tailscale을 통한 디바이스 간 보안 네트워크 연결을 지원한다
5. THE Private_Mode SHALL Syncthing을 통한 디바이스 간 데이터 동기화를 지원한다
6. WHEN 동기화 충돌이 발생하면, THE Private_Mode SHALL 충돌 항목을 사용자에게 표시하고 수동 해결 옵션을 제공한다
7. THE Private_Mode SHALL 로컬 LLM(Ollama 등)을 사용하여 외부 API 호출 없이 AI 기능을 제공한다
8. WHILE Private_Mode가 활성 상태인 동안, THE SayknowMind_System SHALL 텔레메트리 데이터를 수집하거나 전송하지 않는다

### 요구사항 11: Shared Mode

**사용자 스토리:** 사용자로서, 선택한 지식을 암호화하여 다른 사용자와 안전하게 공유하고, 필요 시 접근 권한을 철회하고 싶다.

#### 인수 조건

1. THE Shared_Mode SHALL Lit Protocol v3를 사용하여 콘텐츠 접근 제어를 수행한다
2. THE Shared_Mode SHALL IPFS를 사용하여 공유 콘텐츠를 분산 저장한다
3. THE Shared_Mode SHALL Arweave를 사용하여 영구 저장이 필요한 콘텐츠를 보관한다
4. THE Shared_Mode SHALL Ceramic Network를 사용하여 공유 메타데이터를 관리한다
5. WHEN 사용자가 Document를 공유하면, THE Shared_Mode SHALL 해당 Document를 암호화한 후 분산 네트워크에 업로드한다
6. WHEN 사용자가 공유 링크를 생성하면, THE Shared_Mode SHALL 접근 조건(지갑 주소, 토큰 보유 등)을 설정할 수 있는 인터페이스를 제공한다
7. WHEN 사용자가 공유 권한을 철회(Revoke)하면, THE Shared_Mode SHALL Lit Protocol을 통해 해당 접근 조건을 즉시 무효화한다
8. WHEN 권한이 없는 사용자가 공유 콘텐츠에 접근하면, THE Shared_Mode SHALL 접근을 차단하고 권한 부족 메시지를 표시한다

### 요구사항 12: 데스크톱 앱

**사용자 스토리:** 사용자로서, 브라우저 없이 데스크톱 애플리케이션으로 SayknowMind를 사용하여 네이티브 수준의 사용 경험을 얻고 싶다.

#### 인수 조건

1. THE Desktop_App SHALL Tauri 프레임워크를 사용하여 웹 애플리케이션을 데스크톱 앱으로 패키징한다
2. THE Desktop_App SHALL Windows, macOS, Linux 운영체제를 지원한다
3. THE Desktop_App SHALL 시스템 트레이 아이콘을 제공하여 백그라운드 실행을 지원한다
4. WHEN 사용자가 Desktop_App을 실행하면, THE Desktop_App SHALL 로컬 서비스를 자동으로 시작한다
5. THE Desktop_App SHALL 글로벌 단축키를 제공하여 빠른 검색 창을 호출한다
6. THE Desktop_App SHALL 자동 업데이트 기능을 제공하여 새 버전 출시 시 사용자에게 알림을 표시한다
7. WHEN Desktop_App이 오프라인 상태이면, THE Desktop_App SHALL 로컬에 저장된 데이터를 기반으로 검색 및 탐색 기능을 제공한다

### 요구사항 13: 모바일 앱

**사용자 스토리:** 사용자로서, 모바일 기기에서 SayknowMind에 접근하여 이동 중에도 지식을 검색하고 수집하고 싶다.

#### 인수 조건

1. THE Mobile_App SHALL Android와 iOS 플랫폼을 지원한다
2. THE Mobile_App SHALL Tauri 또는 Capacitor 프레임워크를 사용하여 빌드한다
3. THE Mobile_App SHALL 모바일 화면 크기에 최적화된 반응형 UI를 제공한다
4. WHEN 사용자가 모바일 브라우저에서 콘텐츠를 공유하면, THE Mobile_App SHALL 공유 인텐트를 수신하여 Ingestion_Pipeline으로 전달한다
5. THE Mobile_App SHALL 오프라인 모드를 지원하여 네트워크 연결 없이 캐시된 데이터를 검색한다
6. WHEN 네트워크 연결이 복구되면, THE Mobile_App SHALL 오프라인 중 수집된 데이터를 자동으로 동기화한다
7. THE Mobile_App SHALL 푸시 알림을 통해 새로운 Agent 제안이나 수집 완료 상태를 사용자에게 전달한다

### 요구사항 14: Agent Runtime

**사용자 스토리:** 시스템으로서, 안전하고 효율적인 멀티 에이전트 오케스트레이션을 통해 복잡한 지식 처리 작업을 자동으로 수행하고 싶다.

#### 인수 조건

1. THE ZeroClaw_Runtime SHALL v0.1.7의 안전성이 검증된 기능만 사용한다
2. THE LangGraph_Orchestrator SHALL Stateful 멀티 에이전트 워크플로우를 관리한다
3. WHEN 복잡한 질의가 수신되면, THE LangGraph_Orchestrator SHALL 작업을 하위 태스크로 분해하고 적절한 Agent에 할당한다
4. THE LangGraph_Orchestrator SHALL Agent 간 메시지 전달과 상태 공유를 관리한다
5. WHEN Agent 실행 중 오류가 발생하면, THE ZeroClaw_Runtime SHALL 해당 Agent를 안전하게 종료하고 오류 상태를 LangGraph_Orchestrator에 보고한다
6. THE ZeroClaw_Runtime SHALL 각 Agent의 리소스 사용량(CPU, 메모리)을 모니터링하고 설정된 한도를 초과하면 실행을 제한한다
7. THE LangGraph_Orchestrator SHALL Agent 실행 이력과 결과를 로그로 기록하여 디버깅을 지원한다
8. WHILE Agent가 실행 중인 동안, THE Frontend SHALL 실행 상태와 진행률을 실시간으로 표시한다

### 요구사항 15: Docker 배포

**사용자 스토리:** 시스템 관리자로서, Docker Compose를 사용하여 SayknowMind를 간편하게 설치하고 운영하고 싶다.

#### 인수 조건

1. THE SayknowMind_System SHALL Docker Compose 파일을 제공하여 모든 서비스를 1클릭으로 배포한다
2. THE SayknowMind_System SHALL install.sh 스크립트를 제공하여 사전 요구사항 확인과 초기 설정을 자동화한다
3. WHEN install.sh 스크립트가 실행되면, THE SayknowMind_System SHALL Docker와 Docker Compose 설치 여부를 확인하고 미설치 시 안내 메시지를 표시한다
4. THE SayknowMind_System SHALL 환경 변수 기반 설정을 지원하여 .env 파일로 서비스 구성을 커스터마이징한다
5. THE SayknowMind_System SHALL 각 서비스(Frontend, EdgeQuake_Engine, PostgreSQL 등)를 독립된 컨테이너로 실행한다
6. WHEN Docker 컨테이너가 비정상 종료되면, THE SayknowMind_System SHALL 해당 컨테이너를 자동으로 재시작한다
7. THE SayknowMind_System SHALL 데이터 영속성을 위해 Docker Volume을 사용하여 데이터베이스와 사용자 데이터를 보존한다
8. THE SayknowMind_System SHALL 컨테이너 헬스체크를 구성하여 각 서비스의 정상 동작 여부를 모니터링한다

### 요구사항 16: 비기능 요구사항

**사용자 스토리:** 사용자로서, 빠르고 안전하며 확장 가능한 시스템을 사용하여 대량의 지식 데이터를 안정적으로 관리하고 싶다.

#### 인수 조건

1. WHEN 검색 쿼리가 실행되면, THE SayknowMind_System SHALL 200ms 이내에 응답을 반환한다
2. WHEN 페이지가 로드되면, THE Frontend SHALL 초기 렌더링을 1초 이내에 완료한다
3. THE SayknowMind_System SHALL 10만 개 이상의 Document를 저장하고 검색 성능을 유지한다
4. THE SayknowMind_System SHALL 모든 저장 데이터를 AES-256 암호화로 보호한다
5. THE SayknowMind_System SHALL OWASP Top 10 보안 취약점에 대한 방어 조치를 적용한다
6. THE SayknowMind_System SHALL 한국어, 영어, 일본어, 중국어를 포함한 다국어 콘텐츠의 수집과 검색을 지원한다
7. WHEN 시스템 장애가 발생하면, THE SayknowMind_System SHALL 자동 복구를 시도하고 데이터 손실 없이 서비스를 재개한다
8. THE SayknowMind_System SHALL 99.9% 이상의 가용성을 목표로 운영한다
9. THE SayknowMind_System SHALL API 응답 형식으로 JSON을 사용한다
10. FOR ALL 유효한 API 응답 객체에 대해, JSON으로 직렬화한 후 역직렬화하면 원본과 동일한 객체를 생성한다 (라운드트립 속성)
