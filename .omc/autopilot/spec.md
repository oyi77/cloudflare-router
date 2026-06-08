# Phase 4 Gap Analysis Spec — cf-router

**Generated:** 2026-04-10  
**Source:** Dual analyst (Opus) + architect (Opus) audit after Phase 1–3 completion  
**Current test count:** 163 (10 suites)

---

## Executive Summary

Three remediation phases fixed the most visible security holes (command injection sinks,
auth token hardening, XSS prevention, SIGTERM grace, portless locking, log rotation,
app-manager extraction). However, the audit found **25 distinct gaps** remaining:
5 Critical-severity bugs and injection vectors, 5 High-severity reliability/security
issues, 9 Medium-severity weaknesses, and 6 Low-severity code quality items, plus
15+ routes with zero test coverage.

---

## CRITICAL Gaps

### C-1: SIGTERM handler calls proc.kill() on plain object (bug)
- **File:** `src/server.js` lines 1289–1290
- **What:** APP_PROCESSES stores `{ pid, started_at, command }` plain objects. The SIGTERM
  loop calls `proc.kill('SIGTERM')` which throws TypeError — silently caught. **Zero child
  processes are terminated on shutdown today.**
- **Fix:** Change to `process.kill(proc.pid, 'SIGTERM')` / `process.kill(proc.pid, 'SIGKILL')`.
  Same pattern used correctly at `app-manager.js:42`.

### C-2: Command injection in backup.js via user-supplied URL
- **File:** `src/backup.js` line 85
- **What:** `execSync(\`curl ... "${url}"\`)` where `url` is user-controlled. Double-quoted
  injection: `http://x" ; rm -rf / ; "` breaks out.
- **Fix:** Replace curl execSync with `axios.get(url, { timeout: 5000 })` — matches the
  already-established pattern from Phase 1.

### C-3: Command injection in /api/ssl/all via config-sourced domains
- **File:** `src/server.js` lines 729, 743
- **What:** `/api/ssl/all` iterates domains extracted from nginx configs and mappings, then
  interpolates each into `execSync(\`echo | openssl s_client -connect ${domain}:443 ...\`)`.
  The regex validation at line 742 only guards `/api/ssl/:domain`, not the bulk endpoint.
  A malicious mapping entry achieves RCE.
- **Fix:** Apply domain regex (`/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/`) to every
  domain before the execSync call in /api/ssl/all. Better: use `tls.connect()` (already
  imported at line 12 but unused).

### C-4: Path traversal in /api/nginx/configs/:file write
- **File:** `src/server.js` lines 601–608
- **What:** `req.params.file` joined to `sitesDir` without validation. `PUT
  /api/nginx/configs/..%2F..%2F..%2Fetc%2Fcrontab` writes arbitrary files.
- **Fix:** Validate `req.params.file` matches `/^[a-zA-Z0-9_.-]+\.conf$/` and verify
  `path.resolve(sitesDir, file).startsWith(sitesDir)`.

### C-5: Path traversal in /api/config/import and /api/backup/restore
- **File:** `src/server.js` lines 810–813 (import), 559–568 (restore)
- **What:** 
  - import: `Object.entries(mappings).forEach(([filename, content]) => fs.writeFileSync(path.join(MAPPINGS_DIR, filename), content))` — filename from request body.
  - restore: `restoreBackup(path.join(backupDir, file))` where `file` from `req.body.file`.
  - Both allow directory traversal.
- **Fix:** Validate filename/file with strict regex and path prefix check.

---

## HIGH Gaps

### H-1: AUTH_TOKENS Map never expires (permanent token accumulation)
- **File:** `src/server.js` line 179
- **What:** Tokens are created with `{ created: Date.now() }` and never evicted. Leaked
  tokens remain valid forever. Map grows unboundedly.
- **Fix:** Add 24h TTL check in authMiddleware; periodic setInterval eviction; cap at 100
  tokens max.

### H-2: 8 async routes missing asyncHandler wrapper
- **File:** `src/server.js` lines 307, 312, 317, 333, 423, 442, 711, 739
- **What:** These use bare `async (req, res) =>` with manual try/catch. Code added outside
  the try block causes unhandled rejections. Inconsistent with the established asyncHandler
  pattern.
- **Fix:** Wrap all 8 with `asyncHandler()`.

### H-3: WebSocket connections have no authentication
- **File:** `src/server.js` lines 1132–1149
- **What:** `setupWebSocket` accepts all connections unconditionally. Any client on the
  network receives real-time service names, ports, request counts.
- **Fix:** Validate auth token from WebSocket upgrade query param before accepting connection.

### H-4: MCP APP_PROCESSES is per-process — sharing is an illusion
- **File:** `src/mcp.js:16`, `src/app-manager.js:7`
- **What:** When mcp.js runs as a separate stdio process (the MCP pattern), it gets an
  independent Map instance. Apps started by server.js are invisible to MCP's Map.
  `APP_PROCESSES.has(name)` guard in `startAppProcess` returns false in MCP, risking
  duplicate processes.
- **Fix:** MCP app handlers should call the HTTP API (`localhost:PORT`) instead of
  importing app-manager directly. This gives MCP the real server state.

### H-5: apps.yaml bypasses sanitizeAppConfig at startup and watchdog reload
- **File:** `src/server.js` lines 1262–1273; `src/app-manager.js` lines 28–33
- **What:** `sanitizeAppConfig` whitelist is applied to HTTP API input but not to the
  startup load path or the watchdog's yaml reload. A malicious apps.yaml entry could
  inject arbitrary fields.
- **Fix:** Run `sanitizeAppConfig` (or equivalent validation) on each app config entry at
  startup and during watchdog reload.

---

## MEDIUM Gaps

### M-1: /api/scan-ports missing input validation
- **File:** `src/server.js` lines 840–864
- **What:** `req.body.ports` used directly without validating integer range 1–65535 or
  array length. A 100,000-element array creates 100,000 sockets.
- **Fix:** Validate each port is integer in [1, 65535]; limit array to 100 items.

### M-2: executeHealthCheck timer never cleaned up on delete
- **File:** `src/server.js` lines 687–709
- **What:** `setTimeout(() => executeHealthCheck(id), check.interval)` reschedules on
  every run. Deleting a health check stops the work but leaves the repeating setTimeout
  callback firing indefinitely (returns early on Map miss but wastes cycles).
- **Fix:** Store timeout handle in the health check object; `clearTimeout` on DELETE.

### M-3: portless.js registerService has TOCTOU race
- **File:** `src/portless.js` lines 96–120
- **What:** `loadPortless()` at line 97 reads **outside** the lock. Between read and
  locked-write, another concurrent call could assign the same port.
- **Fix:** Move `loadPortless()` inside the `withWriteLock` scope.

### M-4: Log rotation race condition
- **File:** `src/server.js` lines 1238–1253
- **What:** `writeLog` checks size then rotates then appends — all sync but uncoordinated.
  Two concurrent requests seeing size > 10MB both attempt rotation.
- **Fix:** Wrap the entire rotate+append operation in `withWriteLock` from portless.js, or
  use `rotating-file-stream`.

### M-5: /api/webhooks missing URL validation (SSRF risk)
- **File:** `src/server.js` line 824
- **What:** Webhook URL stored and later used for `axios.post()` calls with no format
  validation. Could be used for SSRF to internal services.
- **Fix:** Validate URL is valid HTTPS with `new URL()` + scheme check.

### M-6: PUT /api/backup/config missing input validation
- **File:** `src/server.js` line 575
- **What:** `saveBackupConfig(req.body)` passes entire body without schema validation.
- **Fix:** Whitelist allowed backup config fields before saving.

### M-7: POST /api/servers spreads entire req.body
- **File:** `src/server.js` line 893
- **What:** `{ id: uuidv4(), ...req.body, ... }` spreads unvalidated extra fields
  (prototype pollution risk with `__proto__`).
- **Fix:** Destructure only validated fields explicitly.

### M-8: Restart endpoint duplicates app lifecycle (bypasses watchdog)
- **File:** `src/server.js` lines 1033–1054 (inline exec)
- **What:** The restart handler creates its own `exec()` child and exit listener instead of
  calling `stopApp()` + `startAppProcess()`. This bypasses the watchdog restart policy.
- **Fix:** Replace inline exec with `stopApp(name)` then `startAppProcess(name, appCfg)`.

### M-9: No process.on('unhandledRejection') handler
- **File:** `src/server.js`
- **What:** Node >= 15 terminates on unhandled rejection by default. Without a handler,
  there is no structured log before termination.
- **Fix:** Add `process.on('unhandledRejection', (err) => { writeLog(...); })`.

---

## LOW Gaps

### L-1: tls module imported but unused
- **File:** `src/server.js` line 12
- **What:** `const tls = require('tls')` — never referenced.
- **Fix:** Remove import, OR use `tls.connect()` for SSL checks (addressing C-3).

### L-2: yaml inline requires throughout server.js
- **File:** `src/server.js` lines 626, 634, 652, 663, 958, 1022, 1065, 1265
- **What:** `const yaml = require('js-yaml')` re-required inside 8 route handlers.
- **Fix:** Hoist single `const yaml = require('js-yaml')` to module top.

### L-3: CORS allows all origins by default
- **File:** `src/server.js` line 51
- **What:** Defaults to `origin: true` (reflect all). Combined with auth headers, allows
  any website to attempt requests.
- **Fix:** Default to `origin: false`; require explicit `CORS_ORIGIN` env var.

### L-4: CSP includes unsafe-inline and unsafe-eval
- **File:** `src/server.js` line 40
- **What:** Negates most XSS protection from CSP headers.
- **Fix:** Requires refactoring dashboard JS to use nonces. Long-term item.

### L-5: WebSocket cleanup missing from SIGTERM
- **File:** `src/server.js` lines 1132–1149, 1283
- **What:** `wss.close()` not called in SIGTERM handler. Existing WebSocket connections
  may prevent clean shutdown.
- **Fix:** Call `wss.close()` before `server.close()` in SIGTERM handler.

### L-6: AUTH_TOKENS has no max-size guard
- (Sub-item of H-1 but separately addressable)

---

## Test Coverage Gaps (25+ routes with zero coverage)

Priority order:
1. Security-sensitive: `/api/config/import`, `/api/nginx/configs` (write), `/api/backup/restore`
2. Reliability-critical: SIGTERM proc.kill behavior, portless registerService atomicity, log rotation trigger
3. Feature routes: `/api/ssl/*`, `/api/health-check/*`, `/api/servers/*`, `/api/webhooks/*`
4. WebSocket auth behavior

---

## Open Questions (Blocking Plan Decisions)

1. **MCP app management strategy**: HTTP API calls vs. pidfile vs. document-the-limitation?
   HTTP API is cleanest but requires server to be running.
2. **Token TTL**: 24h default? Configurable? Should logout invalidate tokens explicitly?
3. **CSP nonce**: Is refactoring the dashboard JS to support nonces in scope, or defer?
4. **CORS lockdown**: Would restricting origins break any existing user deployments?
5. **portless async**: Migrate `registerService` to async to support proper-lockfile, or keep sync API?
