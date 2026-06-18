# SayKnowWork ↔ SayKnowMind — Account Endpoints Integration Spec

> **For the SayKnowWork backend team.** SayKnowMind (the Enterprise edition) needs
> two new endpoints so signed-in users can change their **password** and **display
> name** from inside the app. The SayKnowMind side is **already implemented and
> deployed-ready** (`apps/web/lib/saas-auth.ts`, `apps/web/app/api/account/*`); it
> calls these exact contracts. Implement the two endpoints below and the feature
> works end-to-end — no SayKnowMind changes required.
>
> Status today: both endpoints return **404 Not Found** on
> `https://sayknowwork.ai-ops.click` (verified by probe), so the in-app forms show
> but fail. `POST /v1/auth/login` already works (control: 401 on bad creds).

---

## 0. Context / trust model (recap)

- Login is already delegated: `POST /v1/auth/login` verifies credentials; SayKnowMind
  mints a local session and **stores no SaaS token**.
- Because there is **no per-user SaaS token** held by SayKnowMind, the two new
  endpoints authenticate differently:
  - **change-password** → authenticated by the user's **current password** (the user
    proves identity by knowing it). No service token.
  - **profile (name) update** → authenticated **server-to-server** by a shared
    **service token** (`SAYKNOWWORK_SERVICE_TOKEN`), because a name change has no
    "current value" to verify. Same trust model as the server-to-server login call.
- All calls are **server → server** (SayKnowMind's Next.js server, never the browser),
  over **HTTPS only**.

---

## 1. `POST /v1/auth/change-password`

Change the password of an existing user, authenticated by their current password.

### Request
```
POST /v1/auth/change-password
Content-Type: application/json

{
  "email":           "user@example.com",   // the user's email (login identifier)
  "currentPassword": "<plaintext current>",
  "newPassword":     "<plaintext new>"
}
```

### Behavior
1. Look up the user by `email`. (Same lookup as login's `email` branch.)
2. Verify `currentPassword` against the stored hash — **constant-time** compare.
3. If the user does not exist **or** the password is wrong → **`401`** (do **not**
   distinguish the two — see Security §4).
4. Enforce the password policy on `newPassword` (length, etc.). Reject with `422`.
5. Hash `newPassword` and persist. **Recommended:** revoke the user's other active
   SaaS sessions/refresh tokens.
6. Return **`200`**.

### Responses
| Status | When | Body |
|---|---|---|
| `200` | success | `{ "ok": true }` |
| `401` | wrong current password / unknown user | `{ "error": "Current password is incorrect", "code": "INVALID_PASSWORD" }` |
| `422` | new password fails policy | `{ "error": "Password too weak", "code": "WEAK_PASSWORD" }` |
| `429` | rate limited | `{ "error": "Too many attempts", "code": "RATE_LIMITED" }` |
| `5xx` | server error | `{ "error": "..." }` |

SayKnowMind maps `401` → "current password incorrect" in the UI, and shows
`body.error` / `body.message` for other failures.

---

## 2. `PATCH /v1/auth/profile`

Update a user's display name, authenticated server-to-server by the service token.

### Request
```
PATCH /v1/auth/profile
Authorization: Bearer <SAYKNOWWORK_SERVICE_TOKEN>
Content-Type: application/json

{
  "email":       "user@example.com",
  "displayName": "New Name"
}
```

### Behavior
1. Read the `Authorization: Bearer <token>` header. Compare to the configured
   `SAYKNOWWORK_SERVICE_TOKEN` — **constant-time** compare. Missing/!match → **`401`**.
2. Look up the user by `email`.
3. Validate/sanitize `displayName` (trim, length cap e.g. 1–100 chars, strip control
   chars). Reject empty with `422`.
4. Update the display name. Return **`200`**.

### Responses
| Status | When | Body |
|---|---|---|
| `200` | success | `{ "ok": true }` |
| `401` | missing/invalid service token | `{ "error": "Unauthorized" }` |
| `404` | unknown user | `{ "error": "User not found" }` |
| `422` | invalid name | `{ "error": "Invalid name" }` |

---

## 3. Shared secret — `SAYKNOWWORK_SERVICE_TOKEN`

Used only by endpoint #2 (profile). One strong random secret, set on **both** sides.

- **Generate:** `openssl rand -hex 32` (256-bit). Do **not** commit it; inject via env/secret manager.
- **SayKnowWork side:** store as env `SAYKNOWWORK_SERVICE_TOKEN`; the `/v1/auth/profile`
  handler compares the incoming Bearer token to it (constant-time).
- **SayKnowMind side:** set the **same value** as env `SAYKNOWWORK_SERVICE_TOKEN` on the
  web app (the app reads it in `lib/saas-auth.ts:updateSaasProfile` and sends it).
- **Rotation:** support two valid tokens during rotation (accept old+new), then drop old.

> If this token is not configured on both sides, profile updates fail with `401`.
> Password change does **not** use it.

---

## 4. Security requirements ("보안 부분")

1. **Constant-time comparison** for both the password hash check and the service-token
   check (e.g. `crypto.timingSafeEqual` / `hmac.compare_digest`). Never `==`.
2. **Do not leak user existence.** change-password returns the *same* `401` for
   "unknown user" and "wrong password". Keep response timing similar (do a dummy hash
   when the user is missing) to avoid a timing oracle.
3. **Rate-limit** `change-password` per email **and** per source IP (e.g. 5–10 attempts
   / 15 min) — it's a password-guessing surface. Return `429` over the limit.
4. **Password policy** on `newPassword`: enforce your existing minimum (SayKnowMind's UI
   pre-checks ≥ 8 chars, but the server is the source of truth). Reject reuse of the
   current password if you wish.
5. **Service token = full trust.** Anyone with `SAYKNOWWORK_SERVICE_TOKEN` can rename any
   account. Therefore: keep it secret, rotate it, and — recommended — **restrict
   `/v1/auth/profile` to the SayKnowMind server's egress IP(s)** (allowlist) so a leaked
   token alone isn't enough. The endpoint should never be reachable from browsers.
6. **HTTPS only.** Reject plaintext. Both endpoints are server-to-server.
7. **Session handling.** On password change, revoke the user's *other* sessions/refresh
   tokens (the one changing it can stay). This limits damage if the account was
   compromised.
8. **Audit log.** Record both actions (who, when, source IP, success/failure) for
   forensics — especially `profile` (service-token writes) and failed `change-password`
   attempts.
9. **Input limits.** Cap body size; validate `email` format; cap `displayName` length;
   reject unexpected fields.
10. **Generic 5xx.** Don't return stack traces / internal errors in the body.

---

## 5. Reference implementation (framework-agnostic pseudocode)

```
// POST /v1/auth/change-password
function changePassword(req):
    { email, currentPassword, newPassword } = req.json()
    if not email or not currentPassword or not newPassword: return 400

    if not rateLimiter.allow(key=email) or not rateLimiter.allow(key=req.ip):
        return 429

    user = db.findUserByEmail(email)
    // constant-time + dummy-hash to avoid user-existence timing oracle
    ok = user ? verifyPasswordConstantTime(currentPassword, user.passwordHash)
              : (dummyVerify(currentPassword), false)
    if not ok: return 401 { error: "Current password is incorrect", code: "INVALID_PASSWORD" }

    if not passwordPolicy.ok(newPassword): return 422 { error: "...", code: "WEAK_PASSWORD" }

    user.passwordHash = hash(newPassword)
    db.save(user)
    sessions.revokeAllExceptCurrent(user)        // recommended
    audit("password_change", user, req.ip, success=true)
    return 200 { ok: true }

// PATCH /v1/auth/profile
function updateProfile(req):
    token = bearer(req.headers.authorization)
    if not token or not constantTimeEquals(token, env.SAYKNOWWORK_SERVICE_TOKEN):
        audit("profile_update", null, req.ip, success=false); return 401 { error: "Unauthorized" }

    { email, displayName } = req.json()
    name = sanitize(displayName)                 // trim, 1..100, strip control chars
    if not name: return 422 { error: "Invalid name" }

    user = db.findUserByEmail(email)
    if not user: return 404 { error: "User not found" }

    user.displayName = name
    db.save(user)
    audit("profile_update", user, req.ip, success=true)
    return 200 { ok: true }
```

---

## 6. Test it once implemented

```bash
BASE=https://sayknowwork.ai-ops.click

# change-password — unknown user must return 401 (NOT 404, NOT 500)
curl -i -X POST "$BASE/v1/auth/change-password" \
  -H 'Content-Type: application/json' \
  -d '{"email":"nobody@example.invalid","currentPassword":"x","newPassword":"abcdefgh"}'
# expect: 401 INVALID_PASSWORD

# profile — without the service token must return 401
curl -i -X PATCH "$BASE/v1/auth/profile" \
  -H 'Content-Type: application/json' \
  -d '{"email":"nobody@example.invalid","displayName":"x"}'
# expect: 401 Unauthorized

# profile — with the token, unknown user → 404
curl -i -X PATCH "$BASE/v1/auth/profile" \
  -H "Authorization: Bearer $SAYKNOWWORK_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"email":"nobody@example.invalid","displayName":"x"}'
# expect: 404 User not found
```

A real end-to-end check: sign in to SayKnowMind as a real user → Settings → change the
password / display name → confirm it persists on SayKnowWork and that the new password
works on the next login.

---

## 7. SayKnowMind side (already done — for reference)

- `apps/web/lib/saas-auth.ts` — `changeSaasPassword(email, currentPassword, newPassword)`
  and `updateSaasProfile(email, displayName)`; base URL from env `SAYKNOWWORK_AUTH_URL`
  (default `https://sayknowwork.ai-ops.click`).
- `apps/web/app/api/account/change-password/route.ts` — session-gated; proxies the
  signed-in user's email + the submitted passwords.
- `apps/web/app/api/account/profile/route.ts` — session-gated; sends the service token;
  mirrors the new name onto the local shadow record so the UI updates immediately.
- Web app env to set: `SAYKNOWWORK_SERVICE_TOKEN` (for profile), and optionally
  `SAYKNOWWORK_AUTH_URL` if the SaaS host differs.
