# EdgeQuake 인증 배선 설계 (deep-analysis 결함 #2)

> 2026-06-19 · 9-에이전트 워크플로우(매핑 6 + 설계 2 + 적대적 critic) 산출.
> 원시 데이터: `EDGEQUAKE-AUTH-DESIGN-2026-06-19.data.json` (maps/designs/critic 전문).
> 출처: `DEEP-ANALYSIS-2026-06-17.md` 결함 #2 "Auth under-wired". 사용자 결정으로 진입(2026-06-19).

## TL;DR
EdgeQuake HTTP API는 **기본적으로 전 라우트 무인증**이다. 수정은 *opt-in·단계적·라이브 dashboard를 절대 401하지 않음* 원칙으로, **Phase 0~2는 자율 안전**(default-off이라 현행 배포와 바이트 동일), **Phase 3(scope 바인딩)은 결정-게이트**로 분리한다. canonical identity = **principal-typed dual model**(trusted-service 공유키 + end-user JWT). 다만 "로그인 시 tenant/workspace claim 채우기"는 **로그인 경로에 user→workspace 멤버십 소스가 없고**, dashboard JWT의 tenant UUID가 웹앱 하드코딩 인덱스 태그와 **네임스페이스가 안 맞아서** 막혀있다(둘 다 해결 전엔 dashboard 쿼리가 0건 반환 위험).

## 현재 상태 (매핑 확정)
- **라우터에 붙은 auth 레이어는 `api_key_auth` 하나뿐**(commit ff03128). `EDGEQUAKE_API_KEY` 미설정이면 `enabled=false`로 즉시 `next.run()` → 전 라우트 통과. (`server.rs:96-106`, `middleware.rs:173-176`)
- **JWT 검증 미들웨어/레이어 없음.** JWT는 `/api/v1/auth/me` 핸들러 1곳에서만 수동 검증(`session.rs:257-267`). documents/query/chat/graph/tenants 등 전 비즈니스 라우트 무인증.
- **`TenantContext`는 Infallible extractor** — `X-Tenant/Workspace/User-ID` 헤더를 그냥 읽음(거부 없음). 약 43개 핸들러가 soft context로 사용. spoofable.
- **하드코딩 JWT secret**: `config.rs` 기본 secret(51 & ~129행), `postgres.rs:293`이 `from_env()` 아닌 `default()` 사용. `memory.rs:46/182/272` 동일.
- **키 비교**: `validate_api_key`가 `k == key` 평문 비교(constant-time 아님, `middleware.rs:134`).
- **`tenant_rate_limit`/`RateLimitState` 정의·export만, 라우터에 미배선** → 레이트리밋 동작 안 함.
- **노출도**: EdgeQuake 포트 internal-only(compose 미게시, Helm ClusterIP+Ingress 없음) → 무인증은 *새 외부 구멍은 아님*, defense-in-depth 갭. (그래서 default-off 유지가 회귀 아님)
- **클라이언트**: web=하드코딩 tenant/workspace UUID + (있으면)`EDGEQUAKE_API_KEY`; mcp=공유키, per-user MCP키는 직접 EdgeQuake 차단; **dashboard=per-user JWT**(`apps/dashboard/.../client.ts:174`) → 공유키 강제 시 401.

## Canonical identity 권고
**principal-typed dual model** (메모리 `[[two-data-models]]`·`[[isolation-is-app-layer-only]]` 준수: EdgeQuake tenancy 부활 금지, 격리는 앱레이어 유지):
- **Trusted-service principal** (web, mcp): 공유 `EDGEQUAKE_API_KEY`. `X-Tenant/Workspace/User-ID` 헤더 **그대로 통과**. Postgres `readableClause`가 web 에디션의 **유일한** 격리 권위로 유지. EdgeQuake는 단일 공유 인덱스.
- **End-user principal** (dashboard): per-user JWT, `sub`=정식 호출자 신원.
- **identity 결정을 둘로 쪼갠다**:
  1. **지금 안전(자율)**: 검증된 JWT에서 **`X-User-ID`만 `sub`로 덮어쓰기**(anti-spoof, 핸들러 0개 영향).
  2. **막힘(인간 결정)**: `X-Tenant/Workspace-ID`를 claim에서 스탬핑 — (a) 로그인 경로에 user→default-workspace/tenant 멤버십 소스 **없음**, (b) dashboard tenant UUID ↔ 인덱스 태그 네임스페이스 **불일치**.

## 단계별 플랜 (B의 단계화 + A의 게이트 내부구현)

### Phase 0 — secret 수정 (default-on, blast 0)
1. `edgequake-auth/src/config.rs` — 중복 기본 secret(51 & ~129)을 `const SENTINEL`로. `from_env()`: `JWT_SECRET` 읽어 `len>=32` 검증; 미설정/빈값/==SENTINEL이면 `warn!` 1회; `EDGEQUAKE_AUTH_STRICT` truthy면 Err/panic. **`Default::default()`는 손대지 말 것**(유닛테스트 결정성). *(자율)*
2. `edgequake-api/src/state/postgres.rs:293` — `AuthConfig::default()` → `from_env()`. *(자율)*
3. `edgequake-api/src/state/memory.rs:46/182/272` — **비-test** 팩토리만 `from_env()`; **test 팩토리는 `default()` 유지**(편집 전 3개 중 어느 게 test_state인지 확인). *(자율+검증 1스텝)*
> `JWT_SECRET` 미설정이면 no-op; 설정 시 실제 secret 발효. 단독 출시 가능.

### Phase 1 — 결합 게이트, 구축하되 inert (default-off 유지)
4. `edgequake-api/src/middleware.rs`:
   - `validate_api_key`의 `k==key`(~134)를 constant-time 비교(`subtle::ConstantTimeEq` 또는 기존 `sha2`로 양쪽 해시 후 비교). *(자율)*
   - 기존 `AuthState`(~147)에 `jwt: Option<Arc<JwtService>>` 추가(병렬 struct 신설 X — B의 최소확장). *(자율)*
   - `if !config.enabled { next.run }` + public-path skip 유지. credential 분기: ct-match 공유키→allow(헤더 통과, `Service`); 아니면 `jwt`가 `Some`이고 `verify_token` 성공→**`x-user-id`만 `sub`로 덮고** pass(`User`); 아니면 401. *(자율)*
   - **`/api/v1/auth/login`+`/api/v1/auth/refresh`를 `public_paths`(~107)에 추가** — Design A가 놓친 필수 갭(없으면 enforce 시 로그인 자체가 401). *(자율)*
5. `edgequake-api/src/server.rs` — `EDGEQUAKE_API_KEY` 게이팅(96-105) 유지, `AuthState`에 `Some(jwt_service.clone())` 전달. 86-95 주석을 "JWT도 수용"으로 갱신. **`EDGEQUAKE_REQUIRE_AUTH`(JWT-only 토글)는 아직 추가 X**(dashboard 배포 확정 후). *(자율)*
> 키 없으면 enforce=false → 현행과 동일.

### Phase 2 — 토글 도달 가능화 + 클라이언트 정합 (plumbing, 여전히 off)
6. `docker-compose.yml` — **edgequake** env(60-68)에 `EDGEQUAKE_API_KEY`/`JWT_SECRET`/`EDGEQUAKE_AUTH_STRICT` (모두 `:-` 기본 빈값), **mcp-server** env(~236)에 `EDGEQUAKE_API_KEY`. *(자율)*
7~9. Helm `edgequake.yaml`(키+secret 주입), `mcp-server.yaml`(`EDGEQUAKE_API_KEY`), `secret.yaml`(`JWT_SECRET` 키). *(자율)*
10. `.env.example` — `JWT_SECRET`(>=32B, `openssl rand -hex 32`), `EDGEQUAKE_AUTH_STRICT`, 활성화 순서(키+secret 설정 → web+mcp+edgequake **동시** 재배포 → dashboard 로그인+JWT 데이터콜+공유키콜 검증 → 그 다음 enforce) 문서화. *(자율)*
11. `edgequake-api/src/routes.rs` — 71-82 오해성 "JWT-claims-first" 주석을 구현 모델로 정정; `/metrics`+`/ws/*` 정책 결정. *(주석=자율, 라우트정책=결정)*

### Phase 3 — scope 바인딩 + 인가 (설계-게이트, 비자율)
12. `handlers/auth/session.rs` — `generate_token_with_claims`로 tenant/workspace claim 채우기. **막힘**: user→workspace/tenant 소스 부재 + 인덱스 태그 네임스페이스 불일치 선결.
13. `query_execute.rs`/`completion.rs`/`query_stream.rs` 멤버십 인가; `prompt.rs:20-22`(None-scope→전역 allow-all) 재고. **결정**.
14. `handlers/auth/api_keys.rs:47` — `user_id="demo-user"` → 인증 principal로. (Argon2 DB키 요청시 검증은 별도 큰 작업)

## 자율 vs 인간결정 요약
- **자율 가능**: Phase 0 전체(1-3), Phase 1(4-5, login/refresh 화이트리스트 + ct-compare 포함), Phase 2 plumbing(6-11, default off). → enforce 비활성 + 로그인 화이트리스트라 dashboard 401 불가.
- **인간 결정(블라인드 출시 금지)**: dashboard가 실제로 배포되는 에디션인지 / Phase 3 scope-claim(멤버십 소스 + 네임스페이스 불일치) / `/ws/*`(브라우저가 Authorization 못 보냄)·`/metrics` 정책 / default-on 여부 / `AUTH_STRICT` panic-vs-warn / prod에서 `EDGEQUAKE_API_KEY`+`JWT_SECRET` 실제 플립(dashboard 재로그인 1회 강제, EC2 `.env`+Helm secret 동시 변경).

**순추천**: B의 단계화 + A의 게이트 내부구현, A의 login 화이트리스트 갭 보완, A의 test-factory 주의 유지, scope-claim 바인딩은 멤버십+네임스페이스 결정 뒤로 격리.

---

## 구현 상태 — Phase 0~2 완료 (2026-07-03, session 2341a791)

**전부 default-OFF. `EDGEQUAKE_API_KEY` 미설정 시 현행 배포와 바이트 동일.** 검증: `cargo check`(postgres+vision, sqlx offline) clean · edgequake-auth 34/34 · edgequake-api 475/475 · `helm template` clean · compose/values YAML parse OK.

**Phase 0 (secret)** ✅
- `edgequake-auth/src/config.rs::from_env()` — `EDGEQUAKE_AUTH_STRICT` 배선: JWT_SECRET 미설정/placeholder일 때 strict=true면 panic, 아니면 warn+placeholder(현행). set-but-weak는 기존대로 항상 panic.
- `edgequake-api/src/state/memory.rs` — `new`(:46)·`new_memory`(:182) → `from_env()`; `test_state`(:272)는 `default()` 유지(결정성). `postgres.rs`는 이미 from_env(선행 커밋).

**Phase 1 (게이트, inert)** ✅
- `middleware.rs`: `validate_api_key` → SHA-256 상수시간 비교(기존 sha2 dep, 신규 crate 無). `AuthState`에 `jwt: Option<Arc<JwtService>>` + `.with_jwt()`. `api_key_auth` 이중 principal — 공유키 ct-매치→Service(헤더 통과) / 아니면 유효 JWT→`x-user-id`를 `sub`로 덮고 User / 아니면 401. `/api/v1/auth/{login,refresh}`를 public_paths에 추가.
- `server.rs`: `AuthState::new(cfg).with_jwt(Some(self.state.jwt_service.clone()))`. 주석 갱신(대시보드 JWT 그대로 수용 → 키 강제 마이그레이션 불필요). `EDGEQUAKE_REQUIRE_AUTH`는 미추가(설계대로).
- `routes.rs`: 오해성 "JWT-claims-first" 주석을 구현 모델(헤더 기반 tenant/workspace, JWT는 user id만)로 정정.

**Phase 2 (plumbing, off)** ✅
- `docker-compose.yml`: edgequake env에 `EDGEQUAKE_API_KEY`/`JWT_SECRET`/`EDGEQUAKE_AUTH_STRICT`(모두 `:-` 빈 기본) 추가. **mcp-server env에도 `EDGEQUAKE_API_KEY` 추가**(web은 이미 보유) → EdgeQuake 호출 3서비스(edgequake/web/mcp) 키 일관. health-only 클라(web `services/status`, mcp `health`)는 /health public path라 무관.
- Helm: `edgequake.yaml`(키+JWT_SECRET secretKeyRef + AUTH_STRICT), `mcp-server.yaml`(키), `secret.yaml`(`JWT_SECRET`), `values.yaml`(`secrets.jwtSecret`, `edgequake.authStrict`).
- `.env.example`: 3개 변수 + 활성화 순서 runbook(키+secret 설정 → web·mcp·edgequake 동시 재배포 → dashboard 로그인/JWT콜/공유키콜 검증 → 그 다음 strict/enforce).

**여전히 OPEN (결정 게이트)**
- **Phase 3** (tenant/workspace claim 바인딩) — 미구현(멤버십 소스 + 네임스페이스 불일치 선결).
- **`/metrics` + `/ws/*` public-path 정책** — auth enable 전 결정 필요. 특히 브라우저 WebSocket은 `Authorization` 헤더를 못 보내므로, 지금 enforce하면 `/ws/*` 대시보드 진행률이 401. (default-off라 현재는 무해.)
- **latent(무관/미수정)**: `processor/pdf_processing.rs:208` — `vision` feature OFF일 때 lib-test 컴파일 E0282(타입주석 필요). 프로젝트 기본 feature엔 vision ON이라 실배포 무영향.
