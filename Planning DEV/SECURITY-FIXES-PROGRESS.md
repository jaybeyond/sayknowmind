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
- ⬜ ingest job durable화 (startup sweeper + DB-backed retry)
- ⬜ dead/mock 서브시스템 삭제/격리 (orchestrator/langgraph/zvec/YAML parser/audit)
- ⬜ chat 5xx 폴백 / og SSRF 가드 / Telegram webhook secret 필수 / category ownership
- ⬜ Rust+relay CI 커버리지 (clippy -D, cargo test, relay build/test)
- ⬜ SDK 계약 수정 또는 codegen
- ⬜ desktop lite 잠금 (privileged command origin 가드, ocp commit pin, CSP)
- ⬜ EdgeQuake 격리/성능 (vector batch upsert, pool, RLS SET LOCAL)

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
