# Security & Reliability Remediation Plan — cf-router

**Plan version:** 3 (revised per Architect iteration 2 amendments)
**Date:** 2026-04-10
**Status:** PENDING APPROVAL

---

## Guiding Principles

1. **Security before features** — fix exploitable vulnerabilities before adding capabilities
2. **Tests before refactors** — establish safety net before restructuring code
3. **Atomic phases** — each phase is independently shippable and verifiable
4. **Minimal surface expansion** — no new features in this remediation cycle
5. **Evidence-based completion** — every phase has measurable exit criteria

---

## Phase 1 — Security & Input Validation

### Gap 1: Command injection in MCP handlers and server endpoints

**Attack surface (7 sinks total):**

| # | File | Line | Sink | Vector |
|---|------|------|------|--------|
| 1a | `src/mcp.js` | 410 | `execSync("pkill -f \"apps/${name}\"")` | `name` from MCP args |
| 1b | `src/mcp.js` | 421 | `execSync("pkill -f \"apps/${name}\"")` | `name` from MCP args |
| 1c | `src/server.js` | 685 | `execSync("echo \| openssl s_client -connect ${domain}:443 ...")` | `req.params.domain` |
| 1d | `src/server.js` | 706 | `execSync("pkill -f cloudflared...${config}...")` + `nohup cloudflared --config ${config} run` | `req.body.configPath` |
| 1e | `src/server.js` | 770 | `exec("curl ... -d '{\"text\":\"${message}\"}'")` in `sendWebhook()` | `message` contains user-sourced `check.name`, `check.url` |
| 1f | `src/mcp.js` | 401, 428 | `exec(appCfg.command)` | yaml-sourced command (mitigated by Gap 5 input validation) |
| 1g | `src/server.js` | 642 | `exec("curl ... \"${check.url}\"")` in health check runner | `check.url` from `req.body.url` at line 622, zero validation |

**Fixes:**

- **1a, 1b (MCP name injection):** Create a `validateAppName(name)` helper that tests against `/^[a-zA-Z0-9_-]+$/` AND enforces `name.length <= 128` (prevents pkill argument-length edge cases). Throw on failure. Call it at the entry of `cf_router_app_stop`, `cf_router_app_restart`, and `cf_router_app_start` MCP case handlers — not just "before execSync."
- **1c (SSL domain injection):** Validate `req.params.domain` against `/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/` before the execSync call. Return 400 on failure.
- **1d (tunnel configPath injection):** Use `fs.realpathSync()` (not `path.resolve()`) to resolve symlinks, then verify the resolved path starts with `path.join(process.env.HOME, '.cloudflared/')`. Separately, validate `path.basename(config)` against `/^[a-zA-Z0-9_.-]+\.yml$/` before interpolating into the pkill command. Alternative: switch to `child_process.spawn('pkill', ['-f', pattern])` with array args to eliminate shell interpolation entirely. Return 400 on failure.
- **1e (sendWebhook shell injection):** Replace the shell-based `exec("curl ...")` with `axios.post()` — axios is already a project dependency (`package.json`). Never interpolate user data into shell commands. The `message` parameter contains `check.name` and `check.url` from user config, making this a stored-injection-to-RCE chain.
- **1f (yaml command exec):** Documented as mitigated by Gap 5 (app config field whitelist). Gap 5's validation is the primary control that prevents arbitrary command injection from yaml-sourced config. If an attacker can write arbitrary `command` values via the API, they get RCE via mcp.js lines 401/428.
- **1g (health check URL injection, CRITICAL):** `src/server.js:642` — `exec("curl -s -o /dev/null -w \"%{http_code}\" --max-time 5 \"${check.url}\"")` where `check.url` is set directly from `req.body.url` at line 622 with zero validation. A URL like `"; rm -rf / #` is a critical RCE. Fix: replace `exec(curl ...)` with `axios.get(check.url, { timeout: 5000 })`. Consistent with Gap 1e. Must be in Phase 1.

**Acceptance criteria:**
- All 6 fixable sinks (1a-1e, 1g) reject malicious input or avoid shell interpolation entirely
- Unit tests cover each validation: invalid chars in name, name > 128 chars, domain traversal, symlink in configPath, basename injection in configPath, special chars in webhook message, malicious URL in health check
- `sendWebhook()` uses `axios.post()`, not `exec()`
- Health check URL uses `axios.get()`, not `exec()`
- Phase 1 exit verification: grep for `exec(` and `execSync(` confirms each remaining usage has validated inputs (e.g., `nginx -t` calls using config constants, not user input)

---

### Gap 2: Auth token is raw password

**File:** `src/server.js:142`
**Issue:** `POST /api/auth/login` returns `DASHBOARD_PASSWORD` as the token: `res.json({ success: true, token: DASHBOARD_PASSWORD })`
**Fix:** Generate token via `crypto.randomBytes(32).toString('hex')`. Store in memory (or a Map with expiry). Return generated token, never the password.

**Acceptance criteria:**
- Login response token is a 64-char hex string, not the password
- Token works for subsequent authenticated requests
- Password no longer appears in any API response

---

### Gap 3: Timing-oracle password/token comparison (2 sites)

**File:** `src/server.js`
**Issue:** Two locations use `===` for secret comparison:
- **Line 80** (`authMiddleware`): `token === AUTH_TOKEN || token === DASHBOARD_PASSWORD` — hit on every authenticated request
- **Line 140** (`/api/auth/login`): `password === DASHBOARD_PASSWORD`

**Fix:** Replace both with `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))`, guarded by length check (return false immediately if lengths differ — length is already leaked by the password hash length, so this is acceptable).

**Acceptance criteria:**
- No `===` comparisons remain for password or token values in server.js
- Both line 80 and line 140 use `timingSafeEqual`
- Existing auth tests still pass

---

### Gap 5: Unvalidated PUT /api/apps body (2 endpoints)

**File:** `src/server.js`
**Issue:** Two endpoints write `req.body` directly to apps.yaml:
- **Line 592** `PUT /api/apps` — overwrites entire apps config with raw `req.body`
- **Line 600** `PUT /api/apps/:name` — writes `req.body` as a single app's config

Both feed into `startAppProcess()` which calls `exec(command)`. An attacker who can PUT arbitrary fields achieves RCE via the `command` field.

**Fix:**
- Create a `sanitizeAppConfig(body)` helper that whitelists only: `command`, `script`, `cwd`, `env`, `mode`, `port`, `restartPolicy`, `enabled`, `autoStart`
- Validate types: `command`/`script`/`cwd`/`mode` must be strings; `port` must be integer 1-65535; `env` must be plain object with string values; `enabled`/`autoStart` must be booleans; `restartPolicy` must be one of `always|on-failure|never`
- Apply `sanitizeAppConfig()` to both endpoints
- For `PUT /api/apps` (bulk), apply sanitizer to each app entry in the object
- Validate `:name` param in the second endpoint against `/^[a-zA-Z0-9_-]+$/`

**Acceptance criteria:**
- Unknown fields in PUT body are silently stripped
- Invalid types return 400
- Both endpoints tested with malicious payloads (extra fields, wrong types, injection in command)

---

### Gap 6: Dashboard XSS via innerHTML

**File:** `src/dashboard/index.html`
**Issue:** 38 innerHTML assignment sites. Not all are equally dangerous.

**Categorization:**

**Category A — MUST escape (interpolate server-returned user data):**
These sites inject values that originate from user input or server config (app names, domain names, service names, URLs, health check names, account names, descriptions). Examples:
- Line 844: `${c.name}`, `${c.url}` (health check name/URL from user config)
- Line 893: account data (names, tokens)
- Line 929: `${d.name}`, `${d.zone}` (domain names)
- Line 943: mapping data (domain, path)
- Line 953: DNS record data
- Line 963: tunnel names
- Line 998/1188: app names from yaml config
- Line 1357: account names/emails
- Line 1383: server names/hosts
- Line 1409: portless service names/URLs
- Line 1453: app names, commands, cwd paths
- Line 1512: backup filenames
- Line 1272: language names (from API)
- Line 850: `c.id` in onclick handler (injection into JS context)

**Category B — Safe (static HTML, locally-computed, or non-user-data):**
- Line 716: static "Loading..." string
- Line 838: chart bars from numeric `h.count`/`h.hour` values
- Line 843: static "No custom health checks" placeholder
- Line 880: status badge with hardcoded HTML (running/stopped)
- Line 972/1039: static "Checking..."/"Scanning..." placeholders
- Line 1635/1647/1651/1692/1699/1704/1708: status badge HTML with hardcoded strings

**Fix:**
- Add an `escapeHtml(str)` helper at the top of the script block: `function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }`
- Apply `escapeHtml()` to all Category A interpolation sites for user-sourced values
- Do NOT apply to Category B sites (would break legitimate HTML rendering)
- For line 850 (onclick handler), also escape for JS string context or use `data-id` attribute + event delegation

**Acceptance criteria:**
- All Category A sites pass user data through `escapeHtml()`
- Category B sites remain unchanged
- Manual test: create an app with name `<img src=x onerror=alert(1)>` — no XSS fires in dashboard
- No visual regressions in dashboard (status badges, charts still render correctly)

---

### Gap 10: CLI testService result property mismatch

**File:** `src/cli.js:791-795`
**Issue:** `portless.testService()` returns `{ tcp: { open: bool, port: int }, http: { status: int, latency: int, ok: bool } }` (see `src/portless.js:206`). The CLI code at line 791 tests `result.tcp` (always truthy — it's an object `{open, port}`, not a boolean) instead of `result.tcp.open`. Line 792 uses `result.httpStatus` (undefined) instead of `result.http?.status`, and line 793 uses `result.latency` (undefined) instead of `result.http?.latency`.

**Fix:**
```
// Line 791: result.tcp → result.tcp.open
// Line 792: result.http → result.http?.ok, result.httpStatus → result.http?.status
// Line 793: result.latency → result.http?.latency
// Line 795: !result.tcp && !result.http → !result.tcp.open && !result.http?.ok
```

**Acceptance criteria:**
- `portless:test` command correctly reports "closed" when TCP fails
- `portless:test` command correctly shows HTTP status code and latency
- Exit code 1 only when both TCP and HTTP fail

---

### Phase 1 Exit Criteria

- [ ] All 7 injection sinks (1a-1g) fixed — grep for `exec(` and `execSync(` confirms each remaining usage has validated/trusted inputs
- [ ] `sendWebhook()` uses `axios.post()`, not `exec("curl ...")`
- [ ] Health check runner uses `axios.get()`, not `exec("curl ...")`
- [ ] Login endpoint returns random token, never the raw password
- [ ] All `===` comparisons on secrets replaced with `timingSafeEqual` (lines 80 and 140)
- [ ] Both `PUT /api/apps` endpoints validate and whitelist fields
- [ ] `escapeHtml()` applied to all Category A innerHTML sites
- [ ] CLI `portless:test` reads correct property paths from testService result
- [ ] All new validations have corresponding unit tests
- [ ] Existing 42 tests continue to pass

---

## Phase 2 — Reliability & Test Coverage

### Gap 7: SIGTERM grace period

**File:** `src/server.js` (process lifecycle)
**Fix:** Add `process.on('SIGTERM', ...)` handler that:
1. Stops accepting new connections
2. Waits up to 10s for in-flight requests to complete
3. Kills child processes gracefully (SIGTERM, then SIGKILL after 5s)
4. Exits with code 0

**Acceptance criteria:**
- Server shuts down cleanly on SIGTERM within 15s
- In-flight requests complete (up to 10s timeout)
- Child processes are cleaned up

---

### Gap 8: Portless file locking

**File:** `src/portless.js`
**Fix:** Use `proper-lockfile` (or `fs.open` with `O_EXCL` flag) around `loadPortless()`/`savePortless()` to prevent concurrent writes from corrupting the JSON file.

**Acceptance criteria:**
- Concurrent `register` + `unregister` calls do not corrupt portless.json
- Lock acquisition timeout of 5s with retry
- Stale locks are cleaned up automatically

---

### Gap 11: Log rotation

**File:** `src/server.js` (logging)
**Fix:** Implement log rotation: max 5 files, 10MB each. Use `fs.stat` + `fs.rename` rotation on write, or integrate a lightweight log rotation library.

**Acceptance criteria:**
- Logs do not grow unbounded
- Rotation triggers at 10MB
- 5 rotated files retained

---

### Gap 12: Test coverage (90 net new tests)

**Breakdown (targeting 90 new tests, bringing total from 42 to ~132):**

| Test Suite | Count | Covers |
|------------|-------|--------|
| Portless CRUD | 15 | register, unregister, list, get, update, edge cases |
| App lifecycle API | 20 | PUT /api/apps validation, PUT /api/apps/:name validation, start/stop/restart, invalid payloads |
| MCP tool handlers | 25 | All MCP case handlers with valid/invalid inputs, validateAppName rejection |
| Watchdog restart + backoff | 10 | Restart triggers, backoff escalation, max retries |
| Auth token flow | 10 | randomBytes token generation, timingSafeEqual comparison, token expiry, invalid tokens |
| SIGTERM grace period | 5 | Clean shutdown, in-flight request completion, child process cleanup |
| Portless file locking | 5 | Concurrent writes, stale lock recovery, timeout behavior |

**Acceptance criteria:**
- All 90 new tests pass
- Total test count is >= 130 (42 existing + 90 new, minus any existing tests refactored)
- `npm test` exits 0
- Coverage of security-critical paths (auth, input validation, command execution) >= 80%

---

### Phase 2 Exit Criteria

- [ ] SIGTERM handler tested and working (manual + automated)
- [ ] Portless file locking prevents concurrent corruption
- [ ] Log rotation configured and tested
- [ ] 90+ new tests written and passing
- [ ] Total test suite: >= 130 tests, all green
- [ ] No test depends on network access or external services

---

## Phase 3 — Code Hygiene

### Gap 4: Extract app-manager.js

**File:** `src/server.js` -> new `src/app-manager.js`
**Fix:** Extract app process management into a dedicated module.

**Exit criterion:** `src/app-manager.js` exports `startAppProcess`, `stopApp`, `APP_PROCESSES`; `src/server.js` no longer defines these symbols; all existing tests pass.

---

### Gap 9: Restart deduplication

**File:** `src/server.js` (watchdog / restart logic)
**Fix:** Add a `restartingApps` Set. Before triggering a restart, check if the app name is already in the Set. Remove after restart completes (success or failure).

**Acceptance criteria:**
- Rapid sequential restart requests for the same app are coalesced
- Different apps can restart concurrently
- Set is cleaned up on restart completion

---

### Gap 13: Remove duplicate `net2` require

**File:** `src/server.js:1134`
**Issue:** `const net2 = require('net')` duplicates line 11's `const net = require('net')`. Line 1138 uses `new net2.Socket()`.
**Fix:** Delete line 1134, change `net2.Socket()` on line 1138 to `net.Socket()`. One-line cleanup, folded into Phase 3.

---

### Gap 14: README update

**Fix:** Update README to document:
- New auth token flow (randomBytes-based)
- App config field whitelist
- SIGTERM graceful shutdown behavior
- Log rotation configuration

**Acceptance criteria:** README reflects current behavior for all changed features.

---

### Gap 15: MCP -> HTTP API routing

**Fix:** Refactor MCP handlers to call the HTTP API internally (or shared service functions) rather than duplicating logic. This reduces the attack surface (one validation path instead of two).

**Acceptance criteria:**
- MCP handlers delegate to shared functions (not direct exec/execSync)
- No duplicated business logic between MCP and HTTP paths
- All MCP tests still pass

---

### Phase 3 Exit Criteria

- [ ] `src/app-manager.js` exists and exports `startAppProcess`, `stopApp`, `APP_PROCESSES`
- [ ] `src/server.js` imports from `app-manager.js`, no longer defines those functions
- [ ] `net2` require removed; only `net` used
- [ ] Restart deduplication verified (test: rapid-fire restart of same app)
- [ ] README updated for all changed behaviors
- [ ] MCP handlers use shared functions, not direct shell calls
- [ ] All tests pass (full suite >= 130)

---

## Removed / Deferred Items

| Item | Reason | Disposition |
|------|--------|-------------|
| Gap 16 (Dashboard tabs) | Violates Principle 4 (minimal surface expansion) | **Removed from plan** — future feature work |
| Gap 17 (Log rotation contingency in Phase 3) | Log rotation is definitively in Phase 2 Gap 11; no contingency needed | **Removed** — redundant |

---

## Future Work (out of scope, documented for tracking)

1. **Rate limiting on `/api/auth/login`** — No brute-force protection currently exists. Consider `express-rate-limit` with 5 attempts per 15 minutes per IP. Not in scope for this remediation but should be prioritized next.

2. **CSP headers** — Add `Content-Security-Policy` header to dashboard responses to provide defense-in-depth against XSS beyond the `escapeHtml()` fix.

3. **MCP command chain hardening** — While Gap 5's field whitelist prevents arbitrary `command` values via the API, the yaml file itself could be edited directly on disk. Consider adding command allowlisting or sandboxing for `exec()` calls sourced from yaml config. Gap 5 is the primary control; this is a secondary defense.

---

## ADR: Security Remediation Approach

**Decision:** Fix vulnerabilities in-place with input validation, token replacement, and output escaping rather than architectural rewrite.

**Drivers:**
1. Multiple RCE-grade command injection vulnerabilities require immediate fix
2. Auth token leaks raw password — high severity, low effort fix
3. Dashboard XSS via innerHTML — medium severity, requires careful categorization

**Alternatives considered:**
- **Full rewrite with framework (e.g., Fastify + helmet):** Would fix structural issues but timeline is 3-5x longer; risks regressions in working features.
- **WAF/proxy layer:** Would catch some injection patterns but misses application-logic bugs (wrong property access, timing oracle). Not a substitute for code fixes.

**Why chosen:** In-place fixes address all identified vulnerabilities within a single sprint. The phased approach (security -> tests -> hygiene) ensures each phase is independently valuable and shippable. Framework migration can be evaluated after the remediation stabilizes.

**Consequences:**
- Server.js remains large (mitigated by Phase 3 extraction)
- No structural prevention of future injection bugs (mitigated by test coverage + shared validation helpers)

**Follow-ups:**
- Evaluate framework migration after Phase 3
- Add rate limiting (see Future Work #1)
- Add CSP headers (see Future Work #2)
