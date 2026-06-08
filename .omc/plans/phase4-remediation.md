# Phase 4 Remediation Plan — cf-router

**Created:** 2026-04-10
**Baseline:** 163 tests passing, 10 suites, app-manager extracted, no net2 in server.js
**Scope:** 25 gaps (5 Critical, 5 High, 9 Medium, 6 Low) across ~8 source files
**Out of scope:** L-4 (CSP nonce refactor) deferred to Phase 5

---

## Phase 4a — Critical Bug Fixes

Highest priority, smallest diff. Each story is independently deployable.

---

### C-1: SIGTERM handler calls proc.kill() on plain object

**Files:** `src/server.js` lines 1288-1290

**Problem:** `APP_PROCESSES` stores `{ pid, started_at, command }` plain objects. The SIGTERM loop calls `proc.kill('SIGTERM')` which throws TypeError (plain objects have no `.kill()` method). Zero child processes are terminated on shutdown.

**Fix:**
```js
// BEFORE (line 1288-1290):
for (const [, proc] of APP_PROCESSES.entries()) {
  try { proc.kill('SIGTERM'); } catch (_) {}
  setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 5000);
}

// AFTER:
for (const [, proc] of APP_PROCESSES.entries()) {
  try { process.kill(proc.pid, 'SIGTERM'); } catch (_) {}
  setTimeout(() => { try { process.kill(proc.pid, 'SIGKILL'); } catch (_) {} }, 5000);
}
```

**Acceptance Criteria:**
- `process.kill(proc.pid, 'SIGTERM')` is used instead of `proc.kill('SIGTERM')`
- `process.kill(proc.pid, 'SIGKILL')` is used instead of `proc.kill('SIGKILL')`
- Pattern matches the correct usage already in `app-manager.js:42`
- Test: unit test that mocks `APP_PROCESSES` with plain objects and verifies `process.kill` is called with correct pid and signal args during SIGTERM handler invocation

**Estimated tests:** +2 (SIGTERM sends SIGTERM to all procs, SIGKILL follows after timeout)

---

### C-2: Command injection in backup.js via user-supplied URL

**Files:** `src/backup.js` line 85

**Problem:** `execSync(\`curl ... "${url}"\`)` where `url` comes from the `runHealthCheck` parameter. Double-quote injection breaks out: `http://x" ; rm -rf / ; "`.

**Fix:** Replace `execSync` curl with `axios.get`:
```js
// BEFORE (line 83-86):
urls.forEach(({ name, url }) => {
  try {
    const startTime = Date.now();
    const status = execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${url}"`, { encoding: 'utf8' }).trim();

// AFTER:
const axios = require('axios');
// ... inside forEach:
urls.forEach(({ name, url }) => {
  const startTime = Date.now();
  try {
    // Validate URL format before making request
    new URL(url);
    const response = await axios.get(url, {
      timeout: 5000,
      validateStatus: () => true,
      maxRedirects: 3,
    });
    const latency = Date.now() - startTime;
    results.push({
      name, url,
      status: response.status === 200 ? 'healthy' : 'unhealthy',
      httpStatus: response.status,
      latency,
      checkedAt: new Date().toISOString()
    });
  } catch (error) { ... }
});
```

Note: `runHealthCheck` must become `async` since `axios.get` is async. Callers in `server.js` (line 581: `const results = runHealthCheck(urls || [])`) must `await` the result.

**Acceptance Criteria:**
- No `execSync` with `curl` remains in `backup.js`
- `runHealthCheck` uses `axios.get` with `timeout: 5000` and `validateStatus: () => true`
- URL is validated with `new URL(url)` before request (throws on invalid)
- `runHealthCheck` is async; caller at server.js line 581 awaits it
- `execSync` import in backup.js can be removed if no other uses remain (check: `createAutoBackup` and others don't use it — only `runHealthCheck` did)
- Test: health check with URL containing shell metacharacters does NOT execute them, returns error gracefully

**Estimated tests:** +3 (injection attempt, valid URL check, invalid URL rejection)

---

### C-3: Command injection in /api/ssl/all via config-sourced domains

**Files:** `src/server.js` lines 727-733

**Problem:** `/api/ssl/all` iterates domains from nginx configs and mappings, interpolates each into `execSync(\`echo | openssl s_client -connect ${domain}:443 ...\`)`. The domain regex at line 742 only guards `/api/ssl/:domain`, not the bulk `/api/ssl/all` endpoint. A malicious mapping entry achieves RCE.

**Fix:** Apply domain validation regex to every domain before the execSync call in the ssl/all loop. Use the same regex already at line 742: `/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/`.

```js
// Inside the for loop at line 727, add before the execSync:
const DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
for (const domain of [...domains].slice(0, 30)) {
  if (!DOMAIN_RE.test(domain)) {
    results.push({ domain, error: 'Invalid domain format, skipped' });
    continue;
  }
  // ... existing execSync
}
```

Better long-term: replace `execSync` openssl with `tls.connect()` (the `tls` module is already imported at line 12 but unused — addresses L-1 simultaneously). However, the regex guard is the minimal critical fix.

**Acceptance Criteria:**
- Every domain in `/api/ssl/all` loop is validated against `DOMAIN_RE` before shell interpolation
- Domains failing validation are skipped with an error entry in results (not silently dropped)
- The same `DOMAIN_RE` constant is shared between `/api/ssl/all` and `/api/ssl/:domain`
- Test: request to /api/ssl/all when a mapping contains `"; rm -rf / ; "` as domain returns error entry, does NOT execute shell command

**Estimated tests:** +2 (injection domain skipped, valid domain processed)

---

### C-4: Path traversal in /api/nginx/configs/:file write

**Files:** `src/server.js` lines 601-608

**Problem:** `req.params.file` is joined to `sitesDir` without validation. `PUT /api/nginx/configs/..%2F..%2Fetc%2Fcrontab` writes arbitrary files.

**Fix:**
```js
app.put('/api/nginx/configs/:file', (req, res) => {
  try {
    const sitesDir = path.join(CONFIG_DIR, 'nginx', 'sites');
    const file = req.params.file;

    // Path traversal guard
    if (!/^[a-zA-Z0-9_.-]+\.conf$/.test(file)) {
      return res.status(400).json({ error: 'Invalid config filename' });
    }
    const resolved = path.resolve(sitesDir, file);
    if (!resolved.startsWith(sitesDir)) {
      return res.status(400).json({ error: 'Path traversal detected' });
    }

    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Config not found' });
    fs.writeFileSync(resolved, req.body.content);
    res.json({ success: true, file });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
```

**Acceptance Criteria:**
- `req.params.file` is validated against `/^[a-zA-Z0-9_.-]+\.conf$/`
- `path.resolve()` result is verified to start with `sitesDir`
- Requests with `../`, `..%2F`, or non-.conf extensions return 400
- Test: PUT with `../../etc/passwd` returns 400, PUT with `valid.conf` succeeds

**Estimated tests:** +3 (traversal blocked, non-conf blocked, valid write succeeds)

---

### C-5: Path traversal in /api/config/import and /api/backup/restore

**Files:** `src/server.js` lines 810-813 (import), lines 559-563 (restore)

**Problem:**
- **import:** `Object.entries(mappings).forEach(([filename, content]) => fs.writeFileSync(path.join(MAPPINGS_DIR, filename), content))` — filename from request body allows traversal.
- **restore:** `restoreBackup(path.join(backupDir, file))` where `file` from `req.body.file` — traversal to read/restore arbitrary JSON.

**Fix for import (lines 810-813):**
```js
if (mappings) {
  const SAFE_FILENAME = /^[a-zA-Z0-9_.-]+\.yml$/;
  Object.entries(mappings).forEach(([filename, content]) => {
    if (!SAFE_FILENAME.test(filename)) {
      throw new APIError(`Invalid mapping filename: ${filename}`, 400);
    }
    const resolved = path.resolve(MAPPINGS_DIR, filename);
    if (!resolved.startsWith(path.resolve(MAPPINGS_DIR))) {
      throw new APIError('Path traversal detected', 400);
    }
    fs.writeFileSync(resolved, content);
  });
}
```

**Fix for restore (lines 559-563):**
```js
app.post('/api/backup/restore', (req, res) => {
  try {
    const { file } = req.body;
    if (!file || !/^[a-zA-Z0-9_.-]+\.json$/.test(file)) {
      return res.status(400).json({ error: 'Invalid backup filename' });
    }
    const backupDir = path.join(CONFIG_DIR, 'backups');
    const resolved = path.resolve(backupDir, file);
    if (!resolved.startsWith(path.resolve(backupDir))) {
      return res.status(400).json({ error: 'Path traversal detected' });
    }
    const result = restoreBackup(resolved);
    res.json({ success: true, ...result });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
```

Also fix `restoreBackup` in `backup.js` (line 46) for defense-in-depth: validate filenames before `fs.writeFileSync` in the mappings restoration loop:
```js
// backup.js line 46
Object.entries(backup.mappings).forEach(([filename, content]) => {
  if (!/^[a-zA-Z0-9_.-]+\.yml$/.test(filename)) return; // skip unsafe
  const resolved = path.resolve(MAPPINGS_DIR, filename);
  if (!resolved.startsWith(path.resolve(MAPPINGS_DIR))) return;
  fs.writeFileSync(resolved, content);
});
```

**Acceptance Criteria:**
- `/api/config/import` rejects mapping filenames containing `../` or not matching `*.yml` pattern
- `/api/backup/restore` rejects file values containing `../` or not matching `*.json` pattern
- `backup.js restoreBackup` also validates filenames in its mapping loop (defense-in-depth)
- Both endpoints use `path.resolve` + `startsWith` as second guard
- Test: import with `../../../etc/shadow` filename returns 400; restore with `../../etc/passwd` returns 400

**Estimated tests:** +4 (import traversal blocked, import valid works, restore traversal blocked, restore valid works)

---

## Phase 4b — High Security (auth/access hardening)

---

### H-1: AUTH_TOKENS Map never expires (permanent token accumulation)

**Files:** `src/server.js` lines 114-118 (authMiddleware), line 179 (token creation)

**Problem:** Tokens created with `{ created: Date.now() }` are never evicted. Leaked tokens remain valid forever. Map grows unbounded.

**Fix:**

1. Add TTL check in `authMiddleware` (24h default):
```js
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function authMiddleware(req, res, next) {
  if (!DASHBOARD_PASSWORD && !AUTH_TOKEN) return next();
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query?.token;
  if (safeEqual(token, DASHBOARD_PASSWORD)) return next();
  const tokenData = AUTH_TOKENS.get(token);
  if (tokenData) {
    if (Date.now() - tokenData.created > TOKEN_TTL_MS) {
      AUTH_TOKENS.delete(token);
      return res.status(401).json({ error: 'Token expired', code: 'token_expired' });
    }
    return next();
  }
  res.status(401).json({ error: 'Unauthorized', code: 'auth_required' });
}
```

2. Add periodic eviction + max-size guard (addresses L-6):
```js
// After AUTH_TOKENS declaration:
const MAX_TOKENS = 100;

// In login handler, before creating new token:
if (AUTH_TOKENS.size >= MAX_TOKENS) {
  // Evict oldest
  let oldestKey = null, oldestTime = Infinity;
  for (const [k, v] of AUTH_TOKENS) {
    if (v.created < oldestTime) { oldestTime = v.created; oldestKey = k; }
  }
  if (oldestKey) AUTH_TOKENS.delete(oldestKey);
}

// Periodic cleanup (every 15 min):
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of AUTH_TOKENS) {
    if (now - data.created > TOKEN_TTL_MS) AUTH_TOKENS.delete(token);
  }
}, 15 * 60 * 1000);
```

**Acceptance Criteria:**
- Tokens older than 24h are rejected by authMiddleware and deleted from Map
- Response includes `code: 'token_expired'` for expired tokens (distinct from missing)
- AUTH_TOKENS capped at 100 entries; oldest evicted on overflow
- Periodic cleanup runs every 15 minutes
- No configurability needed (hardcoded 24h is fine for now)
- Test: create token, advance clock past 24h, verify 401 with `token_expired`; create 101 tokens, verify oldest is evicted

**Estimated tests:** +4 (TTL expiry, fresh token works, max-size eviction, periodic cleanup)

---

### H-2: 8 async routes missing asyncHandler wrapper

**Files:** `src/server.js` lines 307, 312, 317, 333, 423, 442, 711, 739

**Problem:** These routes use bare `async (req, res) =>` with manual try/catch. Code added outside the try block causes unhandled rejections. Inconsistent with established `asyncHandler` pattern.

**Routes to wrap:**
1. Line 307: `app.get('/api/accounts/:id/zones/:zoneId/dns', async (req, res) => {`
2. Line 312: `app.get('/api/accounts/:id/tunnels', async (req, res) => {`
3. Line 317: `app.get('/api/dns/all', async (req, res) => {`
4. Line 333: `app.get('/api/tunnels/all', async (req, res) => {`
5. Line 423: `app.post('/api/deploy', async (req, res) => {`
6. Line 442: `app.post('/api/cloudflare/sync', async (req, res) => {`
7. Line 711: `app.get('/api/ssl/all', async (req, res) => {`
8. Line 739: `app.get('/api/ssl/:domain', async (req, res) => {`

**Fix:** For each, replace `async (req, res) => {` with `asyncHandler(async (req, res) => {` and add closing `)` after the handler function. The existing try/catch inside can stay (belt + suspenders) or be removed since asyncHandler feeds errors to the error middleware.

**Acceptance Criteria:**
- All 8 routes use `asyncHandler()` wrapper
- No bare `async (req, res) =>` remains in server.js without asyncHandler
- Existing error handling behavior is preserved (manual try/catch inside is acceptable)
- Test: verify that a thrown error in one of these routes returns proper error JSON (not crashes)

**Estimated tests:** +2 (async throw caught by asyncHandler, verify error middleware formats response)

---

### H-3: WebSocket connections have no authentication

**Files:** `src/server.js` lines 1132-1149

**Problem:** `setupWebSocket` accepts all connections unconditionally. Any client receives real-time service names, ports, request counts.

**Fix:**
```js
function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });
  const clients = new Set();

  wss.on('connection', (ws, req) => {
    // Validate auth token from query string
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (DASHBOARD_PASSWORD || AUTH_TOKEN) {
      const isValid = safeEqual(token, DASHBOARD_PASSWORD) ||
        (AUTH_TOKENS.has(token) && (Date.now() - AUTH_TOKENS.get(token).created <= TOKEN_TTL_MS));
      if (!isValid) {
        ws.close(4001, 'Unauthorized');
        return;
      }
    }

    clients.add(ws);
    ws.send(JSON.stringify({ type: 'stats', data: requestStats }));
    ws.send(JSON.stringify({ type: 'health', data: [...healthChecks.values()] }));
    ws.on('close', () => clients.delete(ws));
  });

  // ... existing intervals unchanged
}
```

Also add `wss.close()` in SIGTERM handler (addresses L-5):
```js
// Store wss reference accessible to SIGTERM handler
// In SIGTERM handler, before server.close():
wss.close();
```

**Acceptance Criteria:**
- WebSocket connections without a valid `?token=` query parameter are rejected with close code 4001
- Valid tokens (password or session token) allow connection
- Expired tokens are rejected
- When no password is configured, connections are accepted (matches HTTP auth behavior)
- `wss.close()` is called during SIGTERM shutdown (L-5 bundled)
- Test: WS connection without token is rejected; WS with valid token receives stats

**Estimated tests:** +3 (WS rejected without auth, WS accepted with auth, WS closed on SIGTERM)

---

### H-4: MCP app handlers use local APP_PROCESSES — state is an illusion

**Files:** `src/mcp.js` lines 397-441 (app start/stop/restart handlers)

**Problem:** When mcp.js runs as a separate stdio process, it gets an independent `APP_PROCESSES` Map. Apps started by server.js are invisible. `APP_PROCESSES.has(name)` returns false in MCP, risking duplicate processes.

**Fix:** MCP app handlers should call the HTTP API on localhost instead of importing app-manager directly. Requires knowing the server port (default 7070, or from env).

```js
// At top of mcp.js, add:
const axios = require('axios');
const SERVER_PORT = process.env.CF_ROUTER_PORT || 7070;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

// Replace cf_router_app_start handler:
case 'cf_router_app_start': {
  const { name } = args;
  if (!name) return { error: 'name is required', code: 'missing_param' };
  try {
    validateAppName(name);
    const res = await axios.post(`${SERVER_URL}/api/apps/${encodeURIComponent(name)}/start`, {}, { timeout: 10000 });
    return res.data;
  } catch (e) {
    return { error: e.response?.data?.error || e.message, code: e.response?.status || 500 };
  }
}
```

Apply same pattern to: `cf_router_app_stop`, `cf_router_app_restart`, `cf_router_app_status`, `cf_router_app_logs`, `cf_router_app_config`.

**Keep** the direct imports for read-only operations that don't depend on APP_PROCESSES state (like `cf_router_app_test` which uses `testService` from portless — that's file-based, not process-state).

**Remove** the `APP_PROCESSES` and `startAppProcess`/`stopApp` imports from mcp.js since they are no longer used directly.

**Acceptance Criteria:**
- MCP app start/stop/restart/status/logs/config handlers call `http://127.0.0.1:{port}/api/apps/...` instead of using app-manager directly
- `APP_PROCESSES` import is removed from mcp.js
- `CF_ROUTER_PORT` env var is respected (default 7070)
- Auth token is passed if configured (read from env or config)
- Test: mock HTTP server, verify MCP tool calls hit the correct HTTP endpoints

**Estimated tests:** +3 (MCP start calls HTTP, MCP stop calls HTTP, MCP restart calls HTTP)

---

### H-5: apps.yaml bypasses sanitizeAppConfig at startup and watchdog reload

**Files:** `src/server.js` lines 1262-1273 (startup), `src/app-manager.js` lines 28-33 (watchdog reload)

**Problem:** `sanitizeAppConfig` whitelist is applied to HTTP API input but not to the startup load path (server.js lines 1266-1269) or the watchdog's yaml reload (app-manager.js line 29-30). A malicious apps.yaml entry could inject arbitrary fields.

**Fix in server.js startup (lines 1262-1273):**
```js
if (fs.existsSync(APPS_YAML)) {
  try {
    const yaml = require('js-yaml');
    const data = yaml.load(fs.readFileSync(APPS_YAML, 'utf8')) || { apps: {} };
    Object.entries(data.apps || {}).forEach(([name, appCfg]) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        console.warn(`[auto-start] Skipping invalid app name: ${name}`);
        return;
      }
      const safeCfg = sanitizeAppConfig(appCfg);
      if (safeCfg.autoStart) {
        startAppProcess(name, safeCfg);
      }
    });
  } catch (e) {
    console.error('[auto-start] Failed to read apps.yaml:', e.message);
  }
}
```

**Fix in app-manager.js watchdog reload (line 29-30):**
Export `sanitizeAppConfig` from server.js or duplicate the whitelist logic in app-manager.js. Preferred: extract `sanitizeAppConfig` to a shared `src/validators.js` module.

```js
// src/validators.js (new shared module)
function sanitizeAppConfig(body) { /* same logic as server.js lines 91-112 */ }
module.exports = { sanitizeAppConfig };

// app-manager.js line 29:
const { sanitizeAppConfig } = require('./validators');
// ...
startAppProcess(name, sanitizeAppConfig(data.apps?.[name] || appCfg), nextBackoff);
```

**Acceptance Criteria:**
- `sanitizeAppConfig` is extracted to `src/validators.js` (shared between server.js and app-manager.js)
- Startup loop validates each app config through `sanitizeAppConfig` before starting
- Watchdog reload validates config through `sanitizeAppConfig` before restarting
- Invalid app names are skipped with a warning log at startup
- Test: apps.yaml with extra `__proto__` field — verify it is stripped before process start

**Estimated tests:** +2 (startup sanitizes config, watchdog reload sanitizes config)

---

## Phase 4c — Medium Quality + Tests

---

### M-1: /api/scan-ports missing input validation

**Files:** `src/server.js` lines 840-864

**Problem:** `req.body.ports` used directly without validating integer range or array length. A 100,000-element array creates 100,000 sockets.

**Fix:**
```js
app.post('/api/scan-ports', (req, res) => {
  let { ports } = req.body;
  ports = ports || [80, 443, 3000, 3001, 3002, 3003, 5432, 6379, 6969, 7070, 8080, 8443];

  if (!Array.isArray(ports) || ports.length > 100) {
    return res.status(400).json({ error: 'ports must be an array of at most 100 items' });
  }
  for (const p of ports) {
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      return res.status(400).json({ error: `Invalid port: ${p}. Must be integer 1-65535` });
    }
  }
  // ... rest unchanged
});
```

**Acceptance Criteria:**
- Array length capped at 100
- Each port validated as integer in [1, 65535]
- Non-array input returns 400
- Test: 101-element array returns 400; port 0 returns 400; port 70000 returns 400; valid array succeeds

**Estimated tests:** +3

---

### M-2: executeHealthCheck timer never cleaned up on delete

**Files:** `src/server.js` lines 687-709 (executeHealthCheck), line 678 (DELETE handler)

**Fix:** Store timeout handle in the health check object; `clearTimeout` on DELETE.

```js
function executeHealthCheck(id) {
  const check = healthChecks.get(id);
  if (!check) return;
  // ... existing check logic ...
  check._timer = setTimeout(() => executeHealthCheck(id), check.interval);
}

app.delete('/api/health-check/:id', (req, res) => {
  const check = healthChecks.get(req.params.id);
  if (check && check._timer) clearTimeout(check._timer);
  healthChecks.delete(req.params.id);
  res.json({ success: true });
});
```

**Acceptance Criteria:**
- setTimeout handle stored on the health check object as `_timer`
- DELETE handler calls `clearTimeout` before removing from Map
- No orphan timers after deletion
- Test: add health check, delete it, verify no further executions

**Estimated tests:** +1

---

### M-3: portless.js registerService has TOCTOU race

**Files:** `src/portless.js` lines 96-120

**Problem:** `loadPortless()` at line 97 reads outside the lock. Between read and locked-write, another concurrent call could assign the same port.

**Fix:** Move `loadPortless()` inside the `withWriteLock` scope. Since `registerService` is async (calls `findFreePort`), we need the lock to span the entire read-check-allocate-write sequence. However, `withWriteLock` is sync. The fix is to move the load inside the lock but keep the async port check outside, or restructure to make the critical section sync.

Simplest fix per constraints ("keep sync API, just fix TOCTOU by moving loadPortless inside the lock"):

```js
async function registerService(serviceName, opts = {}) {
  // Move ALL state reads inside the lock
  return withWriteLock(() => {
    const data = loadPortless();
    if (!data.services) data.services = {};

    if (data.services[serviceName]) {
      return data.services[serviceName].port;
    }

    const usedPorts = Object.values(data.services).map(s => s.port);
    // Sync port allocation within lock (try ports sequentially)
    let port = null;
    for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
      if (!usedPorts.includes(p)) { port = p; break; }
    }
    if (!port) throw new Error(`No free ports in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);

    data.services[serviceName] = {
      port,
      subdomain: opts.subdomain || null,
      description: opts.description || '',
      account: opts.account || null,
      zone: opts.zone || null,
      enabled: true,
      registered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Write directly (we already hold the lock via withWriteLock)
    fs.writeFileSync(PORTLESS_FILE, yaml.dump(data, { indent: 2 }));
    return port;
  });
}
```

Note: This changes `registerService` from async to sync (returns value directly from `withWriteLock`). Callers that `await` it will still work since `await syncValue` resolves immediately. The `isPortFree` network check is dropped inside the lock (acceptable: we just pick the first unused port number from the registry, which is the consistent source of truth).

**Acceptance Criteria:**
- `loadPortless()` is called inside `withWriteLock` scope
- No TOCTOU gap between read and write
- Port allocation uses registry as source of truth (no async network check inside lock)
- `savePortless` call inside `registerService` writes directly since already locked (avoid double-lock)
- Existing tests pass; registerService still returns a port number
- Test: two rapid concurrent registrations get different ports

**Estimated tests:** +1 (concurrent registration test)

---

### M-4: Log rotation race condition

**Files:** `src/server.js` lines 1238-1253

**Problem:** Two concurrent requests seeing size > 10MB both attempt rotation.

**Fix:** Use a simple mutex flag (since writeLog is sync, a boolean guard suffices):

```js
let _rotating = false;
function writeLog(line) {
  try {
    if (!_rotating && fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 10 * 1024 * 1024) {
      _rotating = true;
      try { rotateLog(LOG_FILE); } finally { _rotating = false; }
    }
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch (_) {}
}
```

**Acceptance Criteria:**
- Only one rotation can happen at a time
- Log writes still succeed during rotation
- Test: call writeLog when file is > 10MB, verify single rotation

**Estimated tests:** +1

---

### M-5: /api/webhooks missing URL validation (SSRF risk)

**Files:** `src/server.js` lines 823-826

**Fix:**
```js
app.post('/api/webhooks', (req, res) => {
  const { url, events } = req.body;
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Webhook URL must use http or https' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid webhook URL' });
  }
  webhooks.push({ id: Date.now().toString(), url, events: events || ['health.down', 'deploy.complete'], active: true });
  res.json({ success: true });
});
```

**Acceptance Criteria:**
- URL is validated with `new URL()` constructor
- Only http/https protocols accepted
- Invalid URLs return 400
- Test: `ftp://evil`, `javascript:alert(1)`, empty string all return 400; `https://hooks.slack.com/...` succeeds

**Estimated tests:** +2

---

### M-6: PUT /api/backup/config missing input validation

**Files:** `src/server.js` line 574-576

**Fix:**
```js
app.put('/api/backup/config', (req, res) => {
  const ALLOWED_FIELDS = ['enabled', 'intervalHours', 'maxBackups'];
  const sanitized = {};
  for (const key of ALLOWED_FIELDS) {
    if (req.body[key] !== undefined) sanitized[key] = req.body[key];
  }
  if (sanitized.intervalHours !== undefined && (!Number.isInteger(sanitized.intervalHours) || sanitized.intervalHours < 1 || sanitized.intervalHours > 168)) {
    return res.status(400).json({ error: 'intervalHours must be integer 1-168' });
  }
  if (sanitized.maxBackups !== undefined && (!Number.isInteger(sanitized.maxBackups) || sanitized.maxBackups < 1 || sanitized.maxBackups > 100)) {
    return res.status(400).json({ error: 'maxBackups must be integer 1-100' });
  }
  saveBackupConfig(sanitized);
  res.json({ success: true });
});
```

**Acceptance Criteria:**
- Only `enabled`, `intervalHours`, `maxBackups` fields accepted
- Extra fields (including `__proto__`) are stripped
- intervalHours validated as integer 1-168
- maxBackups validated as integer 1-100
- Test: extra fields stripped; invalid intervalHours returns 400

**Estimated tests:** +2

---

### M-7: POST /api/servers spreads entire req.body

**Files:** `src/server.js` lines 888-897

**Problem:** `{ id: uuidv4(), ...req.body }` spreads unvalidated extra fields (prototype pollution risk with `__proto__`).

**Fix:** Destructure only validated fields:
```js
const { name, type, host, port, username, keyPath } = req.body;
const server = {
  id: uuidv4(),
  name, type, host, port, username, keyPath,
  created_at: new Date().toISOString(),
};
```

Note: The route already has express-validator middleware for these fields (lines 882-887), so only those validated fields should be spread.

**Acceptance Criteria:**
- Only `name, type, host, port, username, keyPath` are included from body
- `__proto__`, `constructor`, and any extra fields are excluded
- Test: POST with `__proto__` field — verify it's not in saved server object

**Estimated tests:** +1

---

### M-8: Restart endpoint duplicates app lifecycle (bypasses watchdog)

**Files:** `src/server.js` lines 1033-1054

**Problem:** The restart handler creates its own `exec()` child and exit listener instead of calling `stopApp()` + `startAppProcess()`. This bypasses the watchdog restart policy.

**Fix:**
```js
app.post('/api/apps/:name/restart', [param('name').trim()], handleValidationErrors, asyncHandler(async (req, res) => {
  const yaml = require('js-yaml');
  const name = req.params.name;

  if (RESTARTING.has(name)) {
    return res.status(409).json({ error: 'App restart already in progress' });
  }
  RESTARTING.add(name);
  try {
    const data = fs.existsSync(APPS_YAML) ? yaml.load(fs.readFileSync(APPS_YAML, 'utf8')) : { apps: {} };
    if (!data.apps?.[name]) throw new APIError('App not found', 404, 'not_found');

    stopApp(name);
    await new Promise(r => setTimeout(r, 500));
    startAppProcess(name, data.apps[name]);
    res.json({ success: true, pid: APP_PROCESSES.get(name)?.pid });
  } finally {
    RESTARTING.delete(name);
  }
}));
```

**Acceptance Criteria:**
- Restart handler uses `stopApp(name)` + `startAppProcess(name, appCfg)` exclusively
- No inline `exec()` call remains in the restart handler
- Watchdog restart policy is preserved (the exit handler in `startAppProcess` handles it)
- RESTARTING guard is preserved
- Test: restart calls stopApp then startAppProcess (mock both, verify call order)

**Estimated tests:** +1

---

### M-9: No process.on('unhandledRejection') handler

**Files:** `src/server.js` (add near SIGTERM handler area, ~line 1283)

**Fix:**
```js
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
  writeLog(`unhandledRejection: ${err?.message || err}`);
});
```

**Acceptance Criteria:**
- `process.on('unhandledRejection')` is registered
- Error is logged via `console.error` and `writeLog`
- Process does NOT exit on unhandled rejection (just logs)
- Test: trigger unhandled rejection, verify it's logged without crash

**Estimated tests:** +1

---

### Low-severity items bundled with medium stories

| Low Item | Bundle With | Fix |
|----------|------------|-----|
| **L-1** (tls imported unused) | **C-3** | If using tls.connect for SSL checks, keep import. Otherwise remove line 12 |
| **L-2** (yaml inline requires x8) | **H-5** | When extracting validators.js, also hoist `const yaml = require('js-yaml')` to module top of server.js. Remove all 8 inline `require('js-yaml')` calls at lines 625, 633, 651, 662, 958, 1022, 1064, 1264 |
| **L-3** (CORS allows all origins) | **M-6** (input validation story) | Change CORS to: `origin: process.env.CORS_ORIGIN \|\| true` (already the code!). Just add documentation in README that `CORS_ORIGIN` should be set in production. Keep `true` as fallback — non-breaking per constraints |
| **L-5** (WebSocket cleanup SIGTERM) | **H-3** | Bundle wss.close() into the WebSocket auth story |
| **L-6** (AUTH_TOKENS max-size) | **H-1** | Already included in H-1 fix |

---

## Test Coverage Additions (Priority Order)

### Tier 1 — Security-sensitive routes (bundle with P4a/P4b stories)

| Route | Test File | Est. Tests |
|-------|-----------|-----------|
| C-1: SIGTERM proc.kill | `tests/app-lifecycle.test.js` | +2 |
| C-2: Health check injection | `tests/security.test.js` | +3 |
| C-3: SSL domain injection | `tests/security.test.js` | +2 |
| C-4: nginx config traversal | `tests/security.test.js` | +3 |
| C-5: import/restore traversal | `tests/security.test.js` | +4 |
| H-1: Token TTL/eviction | `tests/auth-flow.test.js` | +4 |
| H-3: WebSocket auth | `tests/auth-flow.test.js` | +3 |

### Tier 2 — Reliability-critical (bundle with P4b/P4c stories)

| Route | Test File | Est. Tests |
|-------|-----------|-----------|
| H-2: asyncHandler consistency | `tests/api.test.js` | +2 |
| H-5: startup sanitization | `tests/app-lifecycle.test.js` | +2 |
| M-1: scan-ports validation | `tests/validation.test.js` | +3 |
| M-3: portless TOCTOU | `tests/portless.test.js` | +1 |

### Tier 3 — Feature routes (P4c)

| Route | Test File | Est. Tests |
|-------|-----------|-----------|
| M-5: webhook URL validation | `tests/validation.test.js` | +2 |
| M-6: backup config validation | `tests/validation.test.js` | +2 |
| M-7: server body spread | `tests/security.test.js` | +1 |
| H-4: MCP HTTP delegation | `tests/mcp.test.js` | +3 |

**Total estimated new tests:** ~42
**Projected test count after Phase 4:** ~205

---

## Execution Order

```
Phase 4a (Critical Bugs) — do first, each story independently mergeable:
  C-1 → C-2 → C-4 → C-5 → C-3
  (C-3 last because it may involve tls.connect refactor)

Phase 4b (High Security) — after 4a:
  H-5 → H-1 → H-2 → H-3 → H-4
  (H-5 first: creates validators.js shared module used later)
  (H-4 last: largest diff, requires HTTP API to be stable)

Phase 4c (Medium Quality) — after 4b:
  M-7 → M-1 → M-5 → M-6 → M-8 → M-9 → M-2 → M-3 → M-4 → L-2
  (Quick input validation fixes first, then lifecycle/concurrency)
```

---

## Success Criteria

- [ ] All 5 Critical injection/bug fixes deployed with regression tests
- [ ] Auth tokens expire after 24h; WebSocket requires auth
- [ ] MCP app handlers delegate to HTTP API (no stale process state)
- [ ] All async routes wrapped in asyncHandler
- [ ] apps.yaml validated at startup and watchdog reload
- [ ] Test count reaches ~200+ (from current 163)
- [ ] Zero known command injection or path traversal vectors remain
- [ ] `npm test` passes with no warnings or unhandled rejections
