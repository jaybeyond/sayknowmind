# SayKnowMind — Agentic Second Brain (지능형 세컨드 브레인)

> **"Everything you say, we know, and mind forever."**
> 당신이 말한 모든 것을 우리가 알고, 영원히 기억합니다.

**다른 언어로 보기:**
[English](./INTRO.md) · [简体中文](./INTRO.zh-CN.md) · [繁體中文](./INTRO.zh-TW.md) · [日本語](./INTRO.ja.md)

---

**SayKnowMind**는 오픈소스 **개인용 지능형 세컨드 브레인 플랫폼**입니다. 당신이 읽고, 보고, 쓰고, 대화한 모든 것을 AI가 자동으로 캡처·정리·검색해, 언제든 꺼내 쓸 수 있는 "두 번째 두뇌"로 만들어줍니다.

## 세 가지 핵심 원칙

1. **로컬 우선 (Local-First)**
   모든 데이터는 기본적으로 사용자의 기기에만 저장됩니다. **프라이빗 모드**를 켜면 외부로 데이터가 일체 전송되지 않습니다 — 당신의 지식은 오직 당신만의 것입니다.

2. **에이전트 지능 (Agentic Intelligence)**
   여러 AI 에이전트가 콘텐츠를 자동으로 분류·추출·요약·연결합니다. 태그를 직접 달 필요 없이, 캡처하는 순간 지식 그래프가 자동으로 만들어집니다.

3. **모든 플랫폼 지원**
   웹 · 데스크탑(macOS / Windows / Linux, Tauri) · 모바일(iOS / Android, Capacitor) · MCP 서버 · SDK(TypeScript / Python / Go) · 텔레그램 봇 자동 수집까지.

## 기술적 차별점 — 3-Layer RAG 스택

| 계층 | 엔진 | 역할 |
|---|---|---|
| L1 | **EdgeQuake** (Rust) | 고성능 검색 엔진. Apache AGE(그래프) + pgvector(벡터) 결합, 6가지 쿼리 모드 지원 |
| L2 | **UltraRAG** | 에이전트형 RAG 파이프라인 — 자동 분류, ZeroClaw 래핑, YAML 기반 MCP Skills |
| L3 | **zvec** | 초경량 인-프로세스 벡터 엔진. 하이브리드 검색 가속 |

## 이런 분에게 추천합니다

- **데이터를 Notion / ChatGPT / 클라우드 전용 서비스에 올리고 싶지 않은** 개인 지식 관리 사용자
- 탭과 북마크와 스크린샷에 묻혀 살며, "기억해주는 AI"가 필요한 연구자·개발자·콘텐츠 크리에이터
- **자체 호스팅**(Docker / Kubernetes / Railway)으로 데이터 주권을 완전히 통제하고 싶은 팀

## 오픈소스 & 무료

Apache 2.0 라이선스 — 100% 오픈소스, 영구 무료. GitHub와 GitLab 양쪽 미러링 운영. 기여 환영.

---

**더 알아보기:**
[프로젝트 README](../../README.md) · [아키텍처](../../README.md#architecture) · [시작하기](../../README.md#getting-started) · [Kubernetes Helm 차트](../../deploy/helm/sayknowmind/README.md)
