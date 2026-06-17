# 보안·아키텍처 수정 진행 (deep-analysis 로드맵 실행)

> 시작: 2026-06-18 · 브랜치 `feat/collab-docs-mindmaps-rag` · 출처 보고서: `DEEP-ANALYSIS-2026-06-17.md` / `.xlsx`
> 모든 변경은 미커밋(작업트리). 상태: ✅ 완료 · 🟡 부분 · ⬜ 미착수 · 🔒 결정 필요

## NOW (0–2주, 봉쇄)

| # | 항목 | 상태 | 메모 |
|---|------|------|------|
| 1 | EdgeQuake API 인증 배선 + `from_env()` | 🔒 | Rust. canonical identity 소스 결정 필요(JWT subject) 후 진입 |
| 2 | 무인증 웹 라우트 3종 제거/가드 | ✅ | `auth/test` 삭제 · `settings/prompts` requireAdmin · `desktop/runtime` desktop-only 404. tsc clean |
| 3 | 전역 `entities` 충돌 수정 | ✅ | EdgeQuake가 관계형 entities에 안 씀(웹앱 전용) 확인. migration 063: organization_id 추가+백필, 전역 제약→per-org 부분 unique. `document-store.ts` ON CONFLICT (organization_id,name). web tsc clean. ⚠️과거 병합행은 미치유(한계) |
| 4 | vector filter fail-CLOSED | ✅ | `edgequake-query/.../prompt.rs` `matches_tenant_filter(_props)` 둘 다 fail-closed. cargo check 통과(0 errors). scope 미요청 시 동작 불변 |
| 5 | 배포 파이프라인 unblock | 🟡 | **production-deploy.sh에 051–061 추가(완료)** · deploy.yml 통일은 schema_migrations 백필 결정 필요→deferred(경고 주석만) |
| 6 | MCP/web API key 해시화 | ✅ | hash(검증)+enc(표시) 방식 B. 기존 키 백필로 유지·UI 변경 없음. mcp open-admin fallback도 MCP_ALLOW_ANONYMOUS 게이트. ⚠️배포 전 런타임 테스트 권장 |
| 7 | AI 서버 cross-tenant IDOR + dead async | 🟡 | **SKIP_AUTH가 production/키설정 시 무시되도록 SignatureGuard 하드닝(완료).** async 버그는 이미 수정됨(컨트롤러 await). 날조 학습(`getRecentSpansForLearning` success:true 가짜 span)·userId 토큰 derive는 NEXT로 |

## NEXT (1–2개월)
**자율 진행 중 (안전 하드닝 — 사용자 승인 2026-06-18):**
- 🟡 N1: chat 5xx 폴백 — `chat-router.ts` FALLBACK_CODES에 500,502,503,504 추가 (tsc 검증 중)
- 🟡 N2: og SSRF 가드 — `url-fetcher.ts` validateUrl export + `og/[id]/route.ts` isSafeUrl로 두 fetch(page/image) 가드
- 🟡 N3: Telegram webhook secret fail-closed — `telegram/webhook/route.ts` 미설정 시 403 (⚠️동작변경: secret 필수)
- 🟡 N4: category ownership — `document-store.ts` assignDocumentCategory가 동일 user/org 카테고리만 링크(시그니처 불변, 호출처 10+개 일괄 방어)

**결정/파괴적 — 도달 시 확인:**
- 🔒 dead/mock 서브시스템 삭제/격리 (orchestrator/langgraph/zvec/YAML parser/audit) — revive 의도 확인 필요
- 🔒 SDK 계약 수정 또는 codegen — 결정 필요
- ⬜ ingest job durable화 (startup sweeper + DB-backed retry; pg-boss/BullMQ?)
- ⬜ Rust+relay CI 커버리지 (clippy -D, cargo test, relay build/test)
- ⬜ desktop lite 잠금 (privileged command origin 가드, ocp commit pin, CSP)
- ⬜ EdgeQuake 격리/성능 (vector batch upsert, pool, RLS SET LOCAL)

## EdgeQuake 격리 (P-series — #1 논의에서 파생, 진짜 리스크)
> EdgeQuake는 단일 공유 인덱스(포트 internal-only, MCP per-user 키는 직접 EdgeQuake 차단). 실제 누수 리스크는 "EdgeQuake 결과를 PG 재필터 없이 쓰는 웹 경로"였음.
- 🟡 **P1: 재필터 일원화** — `lib/edgequake/visibility.ts` 헬퍼(`filterVisibleDocIds`/`filterVisibleSources` = readableClause). 적용: ultrarag `executor.ts` search step(`/api/pipeline` 라이브 누수, sources 필터+answer 제거), `job-queue.ts` related-docs(소유자 visible 문서만 링크). orchestrator는 dead-path(langgraph 미도달) → SECURITY 주석만. tsc 검증 중.
- ✅ **P2: EdgeQuake API key 강제 (opt-in)** — `server.rs build_router`에 `api_key_auth` 배선. `EDGEQUAKE_API_KEY` 미설정=비활성(현행 무해), 설정=비공개 라우트에 키 요구. web/MCP는 이미 키 전송 ✅. **⚠️ dashboard는 유저 JWT를 보내므로 enable 시 401 — dashboard 먼저 갱신 필요(caveat).** cargo check 통과.
- P3: MCP admin 키 위생. P4: 옵션 B(per-org UUID 워크스페이스, 외부화 시).

## LATER (분기+)
- ⬜ two-data-models를 하나로 collapse (XL, 모든 격리 버그 root cause)
- ⬜ mindmap/sheet 협업 CRDT화 + token refresh + pruning
- ⬜ 진짜 E2E 암호화 + per-resource 공유 시맨틱
- ⬜ web/dashboard 공유 패키지 추출
- ⬜ web-client/EdgeQuake perf/ops 부채
- ⬜ 문서 정합성 (라이선스 모순, AGENTS.md 정정, PRD archived 배너)

## 변경 로그
- **2026-06-18** #2 완료: `apps/web/app/api/auth/test`(삭제), `settings/prompts/route.ts`, `desktop/runtime/route.ts`, `components/settings/prompt-editor.tsx`, `messages/{en,ko,ja,zh}.json`
- **2026-06-18** #5 부분: `scripts/production-deploy.sh`(051–062 추가, bash -n 통과), `.github/workflows/deploy.yml`(위험 경고 주석)
- **2026-06-18** #6 완료: `db/migrations/062_hash_mcp_api_keys.sql`, `lib/ingest/session-helper.ts`, `app/api/user/mcp-key/route.ts`, `packages/mcp-server/src/index.ts` (web tsc/mcp tsc clean)
- **2026-06-18** #7 부분: `apps/ai-server/src/auth/signature.guard.ts` (SKIP_AUTH 하드닝, ai-server tsc clean)
- **2026-06-18** #4 완료: `packages/edgequake/crates/edgequake-query/src/sota_engine/prompt.rs` (matches_tenant_filter(_props) fail-closed, cargo check 통과)
- **2026-06-18** ✅ 커밋 `53ea138 fix(security): NOW-bucket containment` (#2,#4,#5,#6,#7 — 17파일). 기존 무관 변경은 미커밋 보존.
- **2026-06-18** 결정: #3 최소수정 자율 진행 / #1 EdgeQuake 인증 보류(identity 설계 논의 후)

## 다음 결정 필요 (NOW 잔여)
- **#4 vector fail-CLOSED** (Rust, 무결정·자체완결이나 cargo 빌드 검증 필요)
- **#1 EdgeQuake 인증 배선** 🔒 — canonical identity 소스(JWT subject) 결정 필요
- **#3 전역 entity 충돌** 🔒 — two-data-models 민감 영역(per-owner unique 최소수정 vs 전체 collapse) 결정 필요
