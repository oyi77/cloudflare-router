# CF-Router Comprehensive Audit Report

**Project:** Cloudflare Router v2.3.0  
**Audit Date:** 2026-01-22  
**Scope:** Testing, Configuration, Deployment, Observability  
**Overall Status:** MEDIUM maturity — Conditional for production use

---

## 1. TESTING AUDIT

### 1.1 Coverage Summary

**14 test files, ~110+ tests total:**
- Unit tests: 50% (config, security, validation)
- Integration tests: 35% (API, app-lifecycle)
- Security tests: 15% (path-traversal, SSL injection prevention)
- E2E: 1 browser test (Playwright, manual setup required)

**Test Status:**
```
✅ PASS: portless.test.js (15 tests)
✅ PASS: auth-flow.test.js (5+ tests)
✅ PASS: mcp.test.js (10+ tests)
✅ PASS: security.test.js (20+ tests)
✅ PASS: ssl.test.js (15+ tests)
⚠️ FAIL: config.test.js (race condition in removeAccount test)
✅ PASS: Others (error-pages, path-traversal, token-auth, watchdog)
```

### 1.2 What IS Tested ✅

- Auth token TTL and eviction logic
- App name validation (regex: `^[a-zA-Z0-9_-]+$`, max 128 chars)
- Path traversal prevention (rejects `..`, `%2F` in filenames)
- Domain validation for SSL (prevents command injection via semicolons/backticks)
- Portless service registry (port allocation, enable/disable)
- App lifecycle (port/socket/portless modes)
- REST API endpoints (accounts, zones, mappings)
- Error page upload/retrieval

### 1.3 CRITICAL Coverage Gaps ❌

**Untested modules:**
1. `cloudflare.js` — 0 tests for API calls (verifyAccount, discoverZones, deployMappings)
2. `nginx.js` — 0 tests for config generation
3. `tunnel.js` — 0 tests for tunnel config management
4. `watcher.js` — 0 tests for file watching and debounce logic
5. `backup.js` — No test of backup creation, restore, or rollback
6. `dashboard/` — No DOM testing (e2e.js is manual/hardcoded)

**Error scenario gaps:**
- No test of corrupted YAML config recovery
- No test of network timeouts to Cloudflare
- No test of disk-full handling
- No test of concurrent file writes

**Performance:**
- No load testing
- No memory leak detection

### 1.4 Test Quality Issues ⚠️

**Race condition:**
```javascript
// config.test.js:48 — Brittle timing!
const accounts2 = addAccount('Account 2', 'test2@example.com', 'key2');
await new Promise(r => setTimeout(r, 10));  // 10ms may not be enough under load
const accounts1 = addAccount('Account 1', ...);
```
File locking may take > 10ms, causing test to fail intermittently.

**Module-level caching fragility:**
```javascript
// Tests cache server module from src/server.js
// If DASHBOARD_PASSWORD env var is set, it's captured at require time
// Tests that expect password-less mode may fail if env var not cleared
```

**E2E test hardcoded:**
```javascript
// test/e2e.js:17
await page.fill('#login-password', '123456');  // Magic number!
// Not connected to DASHBOARD_PASSWORD environment variable
// Would fail if password changed
```

---

## 2. CONFIGURATION & ENV AUDIT

### 2.1 How Config is Loaded

**Entry point:** `src/config.js:loadConfig()`
```javascript
const CONFIG_FILE = path.join(process.env.HOME, 'projects/cf-router', 'config.yml');
if (!fs.existsSync(CONFIG_FILE)) {
  return DEFAULT_CONFIG;  // Hardcoded defaults
}
return yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8'));  // NO VALIDATION!
```

**Issues:**
- ❌ **No schema validation** — Invalid config silently defaults
- ❌ **No env var substitution** — Can't use `${VAR}` syntax
- ❌ **HOME-dependent** — Unix-only, hardcoded path

### 2.2 Environment Variables

**Documented:**
- `DASHBOARD_PASSWORD` — Dashboard login (in `.env` file)
- `NODE_ENV` — Set to "production" in ecosystem.config.js

**Used but undocumented:**
- `HOME` — Must point to config directory

**Missing:**
- No `.env.example` template
- No validation at startup
- Cloudflare API token stored in YAML (violates 12-factor)

### 2.3 CRITICAL Security Issue: Credentials in Repo

**Current state:**
```bash
$ cat .env
DASHBOARD_PASSWORD=openclaw    # ❌ HARDCODED!
AUTH_TOKEN=openclaw
```

**PROBLEM:** `.env` is in `.gitignore` but ALREADY COMMITTED to repo.
If anyone clones, they have hardcoded password.

**Credential Types:**
1. **Dashboard password** → env var (good)
2. **Cloudflare API tokens** → in `config.yml` plaintext (bad)
3. **Tunnel credentials** → in `~/.cloudflared/` external (OK)

### 2.4 Config File Format

**Format:** YAML  
**Location:** `~/.cloudflare-router/config.yml` or `$HOME/projects/cf-router/config.yml`  
**Validation:** NONE

**Example:**
```yaml
accounts:
  - id: cf_1774046746453_abc123
    name: Main Account
    email: user@example.com
    api_token: cfv4_token_here  # ❌ PLAINTEXT!
    zones:
      - id: z_abc
        domain: example.com
nginx:
  listen_port: 6969
server:
  port: 7070
  host: 0.0.0.0
```

**Risks:**
- ⚠️ Hand-editable (good for ops) but fragile (YAML syntax errors → silent defaults)
- ❌ Secrets in plaintext (should be encrypted)
- ❌ No atomic writes (temp file created but if rename fails, data lost)

### 2.5 Config Validation

**Current:** ZERO validation

```javascript
function loadConfig() {
  ensureDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return { accounts: [], nginx: {...}, server: {...} };
  }
  return yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8'));  // No checks!
}
```

**Missing validation:**
- Accounts: `api_token` not empty, `email` is valid format
- Nginx: `listen_port` in range 1-65535
- Server: `port` in range 1-65535

**Should use Zod schema:**
```javascript
// NOT IMPLEMENTED
const accountSchema = z.object({
  id: z.string().regex(/^cf_/),
  api_token: z.string().min(1),
  email: z.string().email()
});
```

### 2.6 Safe Live Edits?

**Question:** Can operator edit `config.yml` while server is running?

**Answer:** ❌ RISKY

**Why:**
- Server loads config at startup, doesn't reload
- No file watcher on config.yml (only on mappings/ dir)
- Changes require server restart
- No validation means bad edits go unnoticed

---

## 3. DEPLOYMENT AUDIT

### 3.1 Deployment Options

**Supported:**
1. ✅ **Systemd** (`cloudflare-router.service`)
2. ✅ **PM2** (`ecosystem.config.js`)
3. ✅ **Docker** (`Dockerfile`, `docker-compose.yml`)
4. ⚠️ **Bare process** (`npm start` works but no process management)

### 3.2 Systemd Service Issues ⚠️

**File:** `cloudflare-router.service`

**Problems:**
```ini
[Service]
WorkingDirectory=/home/openclaw/.opencode/tools/cloudflare-router
# ❌ Hardcoded path! Won't work on other machines
# ❌ Different from README which says ~/.cloudflare-router
```

**Missing:**
- ❌ No `EnvironmentFile=` to load `.env`
- ❌ No `StandardOutput=journal` (logs go to /dev/null)
- ❌ No `TimeoutStopSec` (no graceful shutdown timeout)
- ⚠️ `Restart=always` with 5s delay can thrash if startup error

**Would fail on:**
- Any non-openclaw user
- Any non-Ubuntu/standard-FHS system
- Any system with different home directory

### 3.3 PM2 Configuration

**File:** `ecosystem.config.js`

**Good:**
- ✅ Memory limit: 512M
- ✅ Exponential backoff on restart
- ✅ Separate log files

**Bad:**
- ❌ Hardcoded paths: `/home/openclaw/projects/cf-router/`
- ⚠️ `max_restarts: 10` might be too aggressive

### 3.4 Docker Configuration

**Dockerfile:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY src/ ./src/
# Creates directories as root
RUN mkdir -p /root/.cloudflare-router/nginx/sites
EXPOSE 7070
CMD ["node", "src/cli.js", "dashboard", "-p", "7070"]
```

**Issues:**
- ⚠️ No `HEALTHCHECK` instruction
- ⚠️ Runs as root user (should be unprivileged)
- ⚠️ Node version not pinned (`20-alpine` will drift)
- ⚠️ No VOLUME hints for data persistence

**docker-compose.yml:**
- ✅ Has health checks for all 3 services
- ❌ Hardcoded path: `~/projects/cf-router`
- ⚠️ `restart: unless-stopped` is permissive

### 3.5 Reproducibility: Can New User Deploy?

**Answer:** ❌ NO

**Blockers:**
1. Systemd service hardcoded to `/home/openclaw/.opencode/tools/cloudflare-router`
2. PM2 config hardcoded to `/home/openclaw/projects/cf-router/`
3. docker-compose.yml uses `~/projects/cf-router` (expands to unknown home)
4. No install/setup script

**Would require manual edits for each deployment**

### 3.6 Graceful Shutdown: ❌ NONE

```javascript
// src/server.js — no signal handlers!
app.listen(7070, () => {
  console.log('Server running on port 7070');
});
// No SIGTERM, SIGINT, or close handlers
```

**When process dies:**
- Active HTTP requests are dropped (no draining)
- File locks may not be released
- Config writes interrupted mid-operation

**Should implement:**
```javascript
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(async () => {
    // Release locks
    // Finalize pending operations
    process.exit(0);
  });
  
  // Force exit after 15s
  setTimeout(() => {
    console.error('Forced shutdown');
    process.exit(1);
  }, 15000);
});
```

### 3.7 Log Rotation: ❌ NONE

**Logs written to:**
- `~/.cloudflare-router/logs/access.log`
- `~/.cloudflare-router/logs/error.log`
- `~/.cloudflare-router/logs/audit.log`
- `~/.cloudflare-router/logs/watcher.log`
- PM2 logs in `logs/pm2-*.log`

**Problem:** No rotation. Logs grow unbounded until disk fills.

**Missing logrotate config:**
```bash
# /etc/logrotate.d/cloudflare-router (not present)
/root/.cloudflare-router/logs/*.log {
  daily
  rotate 7
  compress
  delaycompress
  missingok
  notifempty
}
```

---

## 4. OBSERVABILITY AUDIT

### 4.1 Structured Logging ✅

**Format:** JSON (good!)

```javascript
// src/logger.js:23-33
{
  "timestamp": "2026-01-22T10:30:45.123Z",
  "ip": "192.168.1.1",
  "method": "POST",
  "url": "/api/mappings",
  "status": 201,
  "duration": "45ms",
  "contentLength": 256,
  "userAgent": "Mozilla/5.0...",
  "referer": "-"
}
```

**Gaps:**
- ⚠️ **No log level** — All same priority (no WARN, ERROR, DEBUG)
- ⚠️ **No request ID** — Can't correlate across services
- ⚠️ **No request body** — Can't debug API errors
- ⚠️ **No error stack** — Exceptions not logged with full traceback

### 4.2 Log Destinations: Scattered ⚠️

- File: `~/.cloudflare-router/logs/access.log`, `error.log`, `audit.log`
- stdout/stderr: `console.error()` for fs failures
- PM2 logs: `logs/pm2-out.log`, `logs/pm2-error.log` (if run via PM2)

**Problem:** Can't tail all logs in one place. Missing centralized logging.

**Should implement:** Syslog or centralized log aggregation.

### 4.3 Request IDs / Correlation: ❌ MISSING

**Problem:** When tracing an action (API → Cloudflare → nginx), no way to correlate logs.

```
POST /api/mappings (req-??? no ID!)
  → calls Cloudflare API (no correlation)
  → generates nginx config (no correlation)
  → reloads nginx (no correlation)

Later: Which nginx reload corresponds to that POST? Can't tell!
```

**Should add:**
```javascript
// NOT IMPLEMENTED
const { v4: uuidv4 } = require('uuid');

app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.set('x-request-id', req.id);
  next();
});
```

### 4.4 Metrics: ❌ NONE

**Missing:**
- No Prometheus metrics endpoint
- No request latency percentiles (p50, p95, p99)
- No error rates
- No Cloudflare API call counts
- No active connection count

**Example missing endpoint:**
```javascript
// NOT IMPLEMENTED
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(generatePrometheusMetrics());
});
```

### 4.5 Tracing: ❌ NONE

**Missing:**
- No OpenTelemetry integration
- No distributed tracing
- Can't see Cloudflare API call chains
- Can't measure nginx config generation time

### 4.6 Error Reporting: ❌ NONE

**Missing:**
- No Sentry/Rollbar integration
- No error aggregation
- No alerting on repeated errors
- No blame (which code change caused it?)

---

## 5. CONFIGURATION FILE FORMAT AUDIT

### 5.1 Format & Editability

**Format:** YAML (human-readable, good!)

**Issues:**
- ✅ Easy to read and edit
- ❌ Easy to break (YAML syntax errors → silent defaults)
- ❌ Secrets in plaintext (should be encrypted)
- ❌ No schema/validation

### 5.2 Live Edits While Running?

**Answer:** ⚠️ RISKY

**Why:**
- Server loads config at startup, no hot reload
- File watcher only watches `mappings/`, not `config.yml`
- Changes require server restart
- No validation means bad edits go unnoticed until restart

### 5.3 Backup & Rollback

**Current state:** ⚠️ PARTIAL

**What exists:**
- `config.yml.bak` (manual backup if operator created)
- Old backups: `apps.yaml.bak.1780418221` (timestamp-named, stale)
- `src/backup.js` module (tests don't cover it!)

**What's missing:**
- ❌ No `npm run backup:create` automation
- ❌ No backup versioning
- ❌ No rollback script
- ❌ No backup directory with rotation

**Risk:** If bad change made, operator must manually restore from backup.

### 5.4 Migration on Format Change

**Scenario:** YAML schema changes (e.g., v2 → v3)

**Answer:** ❌ NO MIGRATION SYSTEM

**Example problem:**
```yaml
# v2
accounts:
  - api_token: "cfv4_xxx"

# v3 (nested)
accounts:
  - credentials:
      token: "cfv4_xxx"
```

Code reads old config, accesses `account.credentials.token` → undefined → silent failure.

**Should implement:**
```javascript
// NOT IMPLEMENTED
function migrateConfig(config) {
  if (!config.version || config.version < 3) {
    config.accounts = config.accounts.map(acc => ({
      ...acc,
      credentials: { token: acc.api_token }
    }));
    config.version = 3;
  }
  return config;
}
```

---

## 6. COMPLETENESS AUDIT

### 6.1 README Accuracy ✅

**Documented features match code:**
- ✅ Multi-account support
- ✅ Subdomain management
- ✅ Nginx auto-generate
- ✅ MCP Server
- ✅ Web dashboard
- ⚠️ Port scanning (mentioned but incomplete)

**Missing from docs:**
- ❌ Configuration schema
- ❌ Environment variables (except in code comments)
- ❌ Systemd setup
- ❌ Deployment troubleshooting

### 6.2 AGENTS.md Accuracy ✅

Content is minimal but correct. Lists main files and directories.

**Missing:**
- Entry point (`src/server.js`)
- Required env vars
- API endpoint docs

### 6.3 CLI Commands

**Completions exist:** bash and zsh completion files provided

**Commands documented:**
- account:*, zone:*, add, remove, list, generate, deploy, status, dashboard

**Issue:** Not verified if flag names match code (e.g., `--api-key` vs `--api-token`)

### 6.4 API Endpoints

**Documented in skills:**
- `docs/skills/cf-router-mappings.md` — Only mappings endpoints

**Full list (from code):**
- `/api/accounts` (GET, POST, DELETE)
- `/api/zones` (GET, POST, DELETE)
- `/api/mappings` (GET, POST, DELETE, PATCH)
- `/api/generate` (POST)
- `/api/nginx/*` (various)
- `/api/status` (GET)
- `/api/auth/*` (login, check)
- `/api/error-pages/*` (GET, PUT)
- Plus many more...

**Missing:** No OpenAPI/Swagger spec, no comprehensive docs

### 6.5 Environment Variables

**Documented:**
- In code comments: `DASHBOARD_PASSWORD`, `NODE_ENV`
- In `.env` file (but contains secrets!)

**Missing:**
- `.env.example` template
- Full list with purposes
- Validation requirements

---

## 7. RISK SURFACE

### 7.1 Corrupted Config File ⚠️

**Scenario:** What if `config.yml` has YAML syntax error?

```yaml
# Invalid YAML
api_token: "unclosed quote
zones: [z1, z2]  # Should be array with objects, not strings
```

**Current behavior:**
```javascript
// src/config.js:46
return yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8'));
// Throws YAMLException if syntax invalid
```

**No try-catch, no recovery. Server crashes.**

**Should implement:**
```javascript
function loadConfig() {
  try {
    return yaml.load(...);
  } catch (e) {
    console.error('Config corrupted. Attempting rollback...');
    const backup = getLatestBackup();
    if (backup) {
      restoreBackup(backup);
      return yaml.load(...);
    }
    throw new Error('Config corrupt, no backup available');
  }
}
```

### 7.2 Cloudflare API Down ⚠️

**Scenario:** Cloudflare API becomes unavailable

**Current code:**
```javascript
// src/cloudflare.js
try {
  const response = await axios.get(url, { headers });
  return response.data;
} catch (error) {
  console.error('Cloudflare API error:', error.message);
  throw error;  // Caller must handle
}
```

**No retry logic, no cached fallback, no timeout set.**

**If API down:**
- requests to Cloudflare hang (default axios timeout: 30s)
- Server thread blocked
- Cascading failures

**Should implement:**
```javascript
async function withRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === maxRetries - 1) throw e;
      await sleep(1000 * Math.pow(2, i));  // Exponential backoff
    }
  }
}
```

### 7.3 Local Port Taken ⚠️

**Scenario:** Port 6969 (nginx) or 7070 (server) already in use

**Current code:**
```javascript
// src/server.js
app.listen(7070, () => {
  console.log('Server listening on 7070');
});
// No error handler!
```

**If port taken, process crashes silently.**

**Should implement:**
```javascript
const PORT = process.env.PORT || 7070;
const server = app.listen(PORT);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} in use. Try: PORT=${PORT+1000} npm start`);
    process.exit(1);
  }
  throw err;
});
```

### 7.4 Disk Full ⚠️

**Scenario:** Disk space exhausted while writing logs/config

**Current code:**
```javascript
// src/logger.js:44
fs.appendFile(ACCESS_LOG_FILE, logEntry + '\n', (err) => {
  if (err) console.error('Failed to write access log:', err);
});
```

**If disk full:**
- Logs silently lost (error only to console)
- No alert
- No monitoring
- Subsequent writes may corrupt files

**Config writes also at risk:**
```javascript
// src/config.js:51-52
const tempFile = `${CONFIG_FILE}.tmp`;
fs.writeFileSync(tempFile, ...);
fs.renameSync(tempFile, CONFIG_FILE);  // May fail if disk full!
```

**Should implement:**
```javascript
function checkDiskSpace() {
  const stat = fs.statSync('/');
  const availMB = stat.bavail * stat.blksize / 1024 / 1024;
  if (availMB < 100) {
    console.error('CRITICAL: Disk space low!');
    notify('DISK_CRITICAL', `${availMB}MB available`);
  }
}

setInterval(checkDiskSpace, 60000);
```

### 7.5 Tunnel Credentials Expire ⚠️

**Scenario:** Cloudflare tunnel token expires or is revoked

**Current:** No health check or monitoring

**Stored in:**
```bash
~/.cloudflared/cert.pem
~/.cloudflared/tunnel.json
```

**If expires:**
- `cloudflared` process exits
- No error handling
- Users can't reach services
- No alert

**Should implement:**
```javascript
async function checkTunnelHealth() {
  try {
    const status = await execAsync('cloudflared tunnel info');
    return status.includes('RUNNING');
  } catch {
    return false;
  }
}

setInterval(async () => {
  const healthy = await checkTunnelHealth();
  if (!healthy) {
    notify('CRITICAL', 'Tunnel unhealthy, may need re-auth');
  }
}, 300000);
```

### 7.6 File Lock Stale ⚠️

**Scenario:** Process crashes while holding lock, lock file left behind

**Lock implementation:**
```javascript
const LOCK_OPTIONS = { stale: 5000 };  // 5s timeout
```

**If process dies with lock held:**
1. Lock file left in filesystem
2. Next process waits 5s
3. Breaks lock and proceeds
4. Both processes may write simultaneously
5. Config corruption possible

**Race condition test is brittle:**
```javascript
// tests/config.test.js:48
await new Promise(r => setTimeout(r, 10));  // May timeout!
```

---

## 8. SUMMARY TABLE

| Category | Status | Risk |
|----------|--------|------|
| **Testing** | Moderate | Medium |
| - Unit tests | Good | Low |
| - Integration tests | Partial | Medium |
| - Cloudflare API tests | None | HIGH |
| - Nginx tests | None | HIGH |
| **Configuration** | Poor | HIGH |
| - Env vars | Undocumented | Medium |
| - Schema validation | None | HIGH |
| - Secrets management | Plaintext | CRITICAL |
| **Deployment** | Fair | High |
| - Systemd | Hardcoded paths | HIGH |
| - PM2 | Hardcoded paths | HIGH |
| - Docker | Missing health checks | Medium |
| - Graceful shutdown | None | HIGH |
| - Log rotation | None | HIGH |
| **Observability** | Poor | Medium |
| - Structured logging | Yes | Low |
| - Request IDs | None | Medium |
| - Metrics | None | Medium |
| - Tracing | None | Low |
| - Error reporting | None | Low |

---

## 9. CRITICAL ACTION ITEMS (Before Production)

**P0 (Fix immediately):**
1. Remove `.env` from repo
2. Remove hardcoded paths from systemd, PM2, docker-compose
3. Add config schema validation
4. Add plaintext credentials encryption
5. Implement graceful shutdown
6. Add log rotation

**P1 (High priority):**
1. Add Cloudflare API tests with mocking
2. Add nginx generation tests
3. Fix timing-dependent tests
4. Add request correlation IDs
5. Add health checks endpoint
6. Add retry logic with exponential backoff

**P2 (Next release):**
1. Add metrics (Prometheus)
2. Add error alerting (Sentry)
3. Add backup/restore UI
4. Create `.env.example`
5. Document all env vars

---

## 10. PRODUCTION READINESS CHECKLIST

Before deploying to production:

### Security
- [ ] No credentials in repo (`.env` removed)
- [ ] Secrets encrypted in config.yml
- [ ] Dashboard password from env var only
- [ ] No hardcoded paths

### Testing
- [ ] `npm test` passes 100%
- [ ] Coverage > 70%
- [ ] No flaky tests
- [ ] Cloudflare API mocked
- [ ] Nginx config validated

### Deployment
- [ ] Systemd parameterized (no hardcoded paths)
- [ ] PM2 parameterized
- [ ] Docker non-root user
- [ ] Health checks working
- [ ] Graceful shutdown implemented

### Observability
- [ ] Request IDs logged
- [ ] Log rotation configured
- [ ] `/metrics` endpoint working
- [ ] Error alerting setup
- [ ] Disk space monitoring

### Monitoring
- [ ] Tunnel health checks
- [ ] Cloudflare API quota alerts
- [ ] Process restart limits
- [ ] Log aggregation (syslog/ELK)

