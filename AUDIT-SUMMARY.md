# CF-Router Audit — Executive Summary

**Status:** MEDIUM maturity — Production-ready with conditions  
**Overall Risk:** HIGH (mostly around deployment and secrets)  
**Test Coverage:** Moderate (110+ tests, but critical gaps in API/nginx/tunnel)

---

## Quick Facts

| Metric | Result |
|--------|--------|
| Test Files | 14 |
| Total Tests | 110+ |
| Passing | ~95% (1 flaky test) |
| Coverage | ~60-70% estimated |
| Deployment Options | 3 (systemd, PM2, Docker) |
| Log Format | JSON ✅ |
| Config Validation | None ❌ |
| Secrets Management | Plaintext YAML ❌ |
| Graceful Shutdown | None ❌ |
| Log Rotation | None ❌ |
| Metrics/Tracing | None ❌ |
| CI/CD Pipeline | None ❌ |

---

## 🔴 CRITICAL Issues (Fix Before Production)

1. **Credentials in repo** (`.env` with `DASHBOARD_PASSWORD=openclaw` committed)
   - Risk: Anyone with repo access has dashboard password
   - Fix: Remove `.env`, create `.env.example`

2. **Plaintext secrets in config.yml** (Cloudflare API tokens stored unencrypted)
   - Risk: If config.yml exposed, all API tokens compromised
   - Fix: Encrypt with key from env var

3. **Hardcoded deployment paths**
   - systemd: `/home/openclaw/.opencode/tools/cloudflare-router`
   - PM2: `/home/openclaw/projects/cf-router`
   - docker-compose: `~/projects/cf-router`
   - Risk: Can't deploy anywhere else
   - Fix: Use env vars, `$HOME`, or environment detection

4. **No config validation** (Invalid YAML silently defaults)
   - Risk: Bad config goes unnoticed until runtime
   - Fix: Add Zod schema validation at load time

5. **No log rotation** (Logs grow unbounded until disk fills)
   - Risk: Disk-full = data loss + corruption
   - Fix: Add logrotate config or implement in-app rotation

6. **No graceful shutdown** (No SIGTERM handlers)
   - Risk: Active requests dropped, locks not released
   - Fix: Add signal handlers, drain requests on shutdown

---

## 🟡 HIGH Priority (Next Release)

1. **Test flakiness** (Race condition in config.test.js)
   - 10ms delay may timeout under load
   - Timing-dependent tests are fragile

2. **Untested critical modules**
   - `cloudflare.js` → 0 tests (API integration)
   - `nginx.js` → 0 tests (config generation)
   - `tunnel.js` → 0 tests (tunnel management)
   - `watcher.js` → 0 tests (file watching)
   - `backup.js` → 0 tests (backup/restore)

3. **No observability**
   - No request correlation IDs
   - No metrics/Prometheus
   - No distributed tracing
   - No error alerting (Sentry)

4. **Brittle E2E test** (Hardcoded password, manual setup)
   - Can't be automated in CI/CD
   - Password not synced with `.env`

5. **No error recovery**
   - Corrupted config → server crash
   - Cloudflare API down → cascading failures
   - No retry logic with backoff

---

## ✅ What's Good

- **Security validation** — Path traversal, injection prevention tests
- **Auth logic** — Token TTL, max-token eviction well-tested
- **Structured JSON logging** — Parseable, includes all request metadata
- **Port management** — Portless registry with port allocation
- **Multiple deployment options** — systemd, PM2, Docker all present
- **Health checks** — docker-compose has health check for all services
- **App lifecycle** — Port/socket/portless modes tested

---

## 📊 Test Coverage Breakdown

**Well-Tested (✅):**
- Security: 20+ tests (injection, traversal, validation)
- Auth: Token TTL, expiry, eviction
- Port management: Portless allocation, enable/disable
- API endpoints: Accounts, zones, mappings CRUD
- Validation: Email, subdomain, port range

**Untested (❌):**
- Cloudflare API integration
- Nginx config generation
- Tunnel configuration
- File watching
- Backup/restore
- Corrupted config recovery
- Network timeouts
- Disk-full scenarios
- Concurrent writes

---

## 🚀 Deployment Reality

### Systemd ⚠️
- Hardcoded path: `/home/openclaw/.opencode/tools/cloudflare-router`
- Won't work on other machines without manual edits
- No graceful shutdown timeout

### PM2 ✅
- Well-configured with memory limits and backoff
- But paths hardcoded: `/home/openclaw/projects/cf-router/`

### Docker ⚠️
- Missing HEALTHCHECK instruction
- Runs as root (should be unprivileged user)
- Node version not pinned

### Reproducibility ❌
- New user cannot deploy without manual path edits
- No installation script
- No setup wizard

---

## 🔒 Security Issues

| Issue | Severity | Impact |
|-------|----------|--------|
| Credentials in `.env` (repo) | CRITICAL | Hardcoded password exposed |
| Plaintext tokens in YAML | CRITICAL | API tokens exposed if file leaked |
| No config validation | HIGH | Invalid config silently defaults |
| No HTTPS between services | HIGH | Traffic within docker-compose unencrypted |
| Rate limiting memory-only | MEDIUM | Resets on restart, no persistence |

---

## 📋 Config Quality Issues

**Format:** YAML (good — human-readable)

**Validation:** NONE ❌
```javascript
// Currently:
return yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8'));

// Should be:
const schema = z.object({ accounts: z.array(accountSchema), ... });
schema.parse(yaml.load(...));
```

**Secrets:** Plaintext ❌
```yaml
# Currently:
api_token: cfv4_token_here  # Visible in file!

# Should encrypt:
api_token: $ENCRYPTED[...]  # Decrypt with env var
```

**Backup/Rollback:** Manual only ⚠️
- Old backups exist but stale
- No automated rollback on bad change
- No rollback UI

---

## 📊 Observability Gaps

| Feature | Status | Impact |
|---------|--------|--------|
| Structured Logging | ✅ JSON | Good |
| Log Levels | ❌ Missing | Can't filter by severity |
| Request IDs | ❌ Missing | Can't correlate across services |
| Metrics | ❌ Missing | No Prometheus/StatsD |
| Tracing | ❌ Missing | Can't see API call chains |
| Error Alerts | ❌ Missing | No Sentry/Rollbar |
| Log Rotation | ❌ Missing | Disk fills |

---

## 🛠️ Recommended Fixes (Priority Order)

**Week 1 (CRITICAL):**
```bash
1. Remove .env from repo, create .env.example
2. Fix hardcoded paths (use $HOME, env vars)
3. Add config schema validation (Zod)
4. Encrypt secrets in config.yml
5. Add graceful shutdown handlers
```

**Week 2 (HIGH):**
```bash
6. Fix timing-dependent tests
7. Add Cloudflare API mocking + tests
8. Add nginx validation tests
9. Add request correlation IDs
10. Add health check endpoint
```

**Week 3 (MEDIUM):**
```bash
11. Add Prometheus metrics
12. Fix log rotation
13. Add error alerting (Sentry)
14. Document all env vars
15. Automate E2E tests
```

---

## ✅ Production Readiness Checklist

Before deploying to production, ensure:

**Security:**
- [ ] `.env` removed from repo
- [ ] Secrets encrypted in config.yml
- [ ] API tokens NOT in logs
- [ ] No hardcoded paths

**Testing:**
- [ ] `npm test` passes 100%
- [ ] Coverage > 70%
- [ ] Cloudflare API mocked
- [ ] No flaky/timing tests

**Deployment:**
- [ ] Paths parameterized (no hardcoding)
- [ ] Graceful shutdown working
- [ ] Health checks passing
- [ ] Log rotation enabled

**Observability:**
- [ ] Request IDs in logs
- [ ] Metrics endpoint `/metrics`
- [ ] Error alerting setup
- [ ] Log aggregation working

**Monitoring:**
- [ ] Tunnel health checks
- [ ] Disk space alerts
- [ ] Process restart limits
- [ ] API quota monitoring

---

## 🎯 Bottom Line

**Is it production-ready?**

> ❌ **Not yet**, but close.

**Main blockers:**
1. Secrets in repo and plaintext YAML
2. Hardcoded deployment paths
3. Missing critical module tests
4. No graceful shutdown

**With fixes, this becomes a solid tool.** The security validation and multi-deployment options are well-designed. Just needs better ops hardening and test coverage for edge cases.

**Estimated fix time:** 2-3 weeks for all critical issues.

