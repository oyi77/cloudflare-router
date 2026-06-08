# CF-Router Hardcoded Values Security/Correctness Audit

## EXECUTIVE SUMMARY

**Critical Findings:** 11  
**High Priority (Config):** 18  
**Medium Priority (Legitimate Constants):** 22  
**Low Priority (Strings/Messages):** 25+

---

## CRITICAL SECURITY ISSUES

### 1. Exposed Credentials in Configuration Files

#### ⚠️ CRITICAL: API Keys, Tokens, Credentials

| File | Line | Finding | Verdict |
|------|------|---------|---------|
| `/home/openclaw/projects/cf-router/config.yml` | 4 | Email: `mbahkoe.pendekar@gmail.com` | **EXPOSED EMAIL** — Move to env var or .env.secret |
| `/home/openclaw/projects/cf-router/config.yml` | 5 | API Key: `4bcf5441dd2f3a5afcd3e8feaad145e8fc49a` | **EXPOSED CLOUDFLARE API KEY** — Delete immediately, rotate key |
| `/home/openclaw/projects/cf-router/config.yml` | 7 | Zone ID: `e160bb3298781f0de25dddea5fd516a9` | **EXPOSED ZONE ID** (32-char hex) — Not secret but tied to account |
| `/home/openclaw/projects/cf-router/config.yml` | 9 | Tunnel ID: `0621c8e9-edab-448f-9434-17807b184c35` | **EXPOSED TUNNEL ID** — Not secret by design, but maps to zone |
| `/home/openclaw/projects/cf-router/config.yml` | 10 | Credentials Path: `/etc/cloudflared/a3e2e1d923eed92e8809c685404009d8.json` | **EXPOSED TUNNEL CREDENTIALS PATH** — Contains sensitive JSON |
| `/home/openclaw/projects/cf-router/config.yml` | 21 | Account ID: `a3e2e1d923eed92e8809c685404009d8` | **EXPOSED ACCOUNT ID** (32-char hex) — Not secret, but identifying |
| `/home/openclaw/projects/cf-router/.env` | 2 | `DASHBOARD_PASSWORD=openclaw` | **HARDCODED DEFAULT PASSWORD** — Move to env var, set strong default |
| `/home/openclaw/projects/cf-router/.env` | 3 | `AUTH_TOKEN=openclaw` | **HARDCODED DEFAULT TOKEN** — Move to env var, generate secure token |

#### Backup Files (Same Credentials)
- `/home/openclaw/projects/cf-router/backups/auto-*.json` (all contain same credentials)

---

## HIGH PRIORITY: HARDCODED PORTS (Configuration Concern)

### 2. Hardcoded Ports — Should Be Environment Variables

| File | Line | Port | Context | Verdict |
|------|------|------|---------|---------|
| `/home/openclaw/projects/cf-router/src/config.js` | 41 | **6969** | `nginx.listen_port` default | Should be `process.env.NGINX_PORT` |
| `/home/openclaw/projects/cf-router/src/config.js` | 42 | **7070** | `server.port` default | Should be `process.env.PORT` or `process.env.DASHBOARD_PORT` |
| `/home/openclaw/projects/cf-router/src/server.js` | 79 | N/A | `DASHBOARD_USERNAME='openclaw'` | **Hardcoded Default** — Set via env var |
| `/home/openclaw/projects/cf-router/src/server.js` | 80 | N/A | `DASHBOARD_PASSWORD='openclaw'` | **Hardcoded Default** — Set via env var |
| `/home/openclaw/projects/cf-router/src/cli.js` | 277 | **7070** | Default port in CLI | Should use config value |
| `/home/openclaw/projects/cf-router/src/cli.js` | 807 | **7070** | Default fallback | Should use config value |
| `/home/openclaw/projects/cf-router/src/mcp.js` | 22 | **7070** | Default in MCP | Should use config value |
| `/home/openclaw/projects/cf-router/src/mcp.js` | 24 | **7070** | Fallback | Should use config value |
| `/home/openclaw/projects/cf-router/src/server.js` | 1154 | **7070** | Default config | Should use `process.env.PORT` |
| `/home/openclaw/projects/cf-router/src/server.js` | 1155 | **6969** | Default nginx port | Should use `process.env.NGINX_PORT` |
| `/home/openclaw/projects/cf-router/src/server.js` | 1338 | **7070** | startServer function | Should be parameterized |
| `/home/openclaw/projects/cf-router/src/server.js` | 1392 | **7070** | Process startup | Should use config |
| `/home/openclaw/projects/cf-router/ecosystem.config.js` | 13 | **7070** | PM2 config | Should use `process.env.PORT` |
| `/home/openclaw/projects/cf-router/docker-compose.yml` | 9 | **7070** | Docker port mapping | Should be externalized |
| `/home/openclaw/projects/cf-router/docker-compose.yml` | 14 | **123456** | Docker default password | **WEAK DEFAULT** — Require strong password |
| `/home/openclaw/projects/cf-router/docker-compose.yml` | 26 | **6969** | Nginx port in Docker | Should be configurable |
| `/home/openclaw/projects/cf-router/docker-compose.yml` | 33 | **6969** | Healthcheck URL | Should match nginx port |
| `/home/openclaw/projects/cf-router/Dockerfile` | 15 | **7070** | EXPOSE instruction | Matches env but should be consistent |

---

## HIGH PRIORITY: HARDCODED PATHS

### 3. System Paths — Should Use Environment Variables or Config

| File | Line | Path | Context | Verdict |
|------|------|------|---------|---------|
| `/home/openclaw/projects/cf-router/src/tunnel.js` | 26 | `/tmp/cloudflared-router.log` | Log file path | Should be `process.env.LOG_DIR` |
| `/home/openclaw/projects/cf-router/nginx/nginx.conf` | 4 | `/var/log/nginx/cloudflare-router-access.log` | Access log path | Should be configurable |
| `/home/openclaw/projects/cf-router/nginx/nginx.conf` | 5 | `/var/log/nginx/cloudflare-router-error.log` | Error log path | Should be configurable |
| `/home/openclaw/projects/cf-router/package.json` | 30 | `/etc/bash_completion.d/` | Bash completions | Should use config-aware install |
| `/home/openclaw/projects/cf-router/package.json` | 30 | `/usr/share/zsh/site-functions/` | Zsh completions | Should use config-aware install |

### 4. User Home Paths — Uses process.env.HOME (Good Pattern)

| File | Lines | Finding |
|------|-------|---------|
| `/home/openclaw/projects/cf-router/src/config.js` | 6 | `path.join(process.env.HOME, 'projects/cf-router')` | ✓ Uses env var |
| `/home/openclaw/projects/cf-router/src/mcp.js` | 5 | Same pattern | ✓ Uses env var |
| `/home/openclaw/projects/cf-router/src/watcher.js` | 19-20 | Same pattern | ✓ Uses env var |
| `/home/openclaw/projects/cf-router/src/portless.js` | 15 | Same pattern | ✓ Uses env var |
| `/home/openclaw/projects/cf-router/src/middleware.js` | 9 | Same pattern | ✓ Uses env var |
| `/home/openclaw/projects/cf-router/src/app-manager.js` | 25 | `path.join(process.env.HOME, 'apps', name)` | ✓ Uses env var |

---

## HIGH PRIORITY: HARDCODED DOMAIN NAMES

### 5. Domain Names & Hostnames

| File | Line | Domain | Verdict |
|------|------|--------|---------|
| `/home/openclaw/projects/cf-router/config.yml` | 8 | `aitradepulse.com` | Should be in config file (it is) |
| `/home/openclaw/projects/cf-router/apps.yaml` | Multiple | `aitradepulse.com` (subdomains) | Configuration files — OK |
| `/home/openclaw/projects/cf-router/mappings/*.yml` | Multiple | `aitradepulse.com` | Configuration files — OK |
| `/home/openclaw/projects/cf-router/docker-compose.yml` | 11 | `~/projects/cf-router` | Should be `$HOME/projects/cf-router` |
| `/home/openclaw/projects/cf-router/docker-compose.yml` | 28 | `~/projects/cf-router/nginx` | Should be `$HOME/projects/cf-router/nginx` |

---

## MEDIUM PRIORITY: HARDCODED URLS (Legitimate APIs/CDNs)

### 6. API Endpoints & CDN URLs — Legitimate but Could Be Configurable

| File | Line | URL | Verdict |
|------|------|-----|---------|
| `/home/openclaw/projects/cf-router/src/cloudflare.js` | 4 | `https://api.cloudflare.com/client/v4` | ✓ Legitimate API endpoint — could move to config |
| `/home/openclaw/projects/cf-router/src/server.js` | 41 | `cdnjs.cloudflare.com` (CSP) | ✓ Legitimate CDN — hardcode OK |
| `/home/openclaw/projects/cf-router/src/server.js` | 43 | `static.cloudflareinsights.com` (CSP) | ✓ Legitimate service — hardcode OK |
| `/home/openclaw/projects/cf-router/src/server.js` | 45 | `fonts.googleapis.com` (CSP) | ✓ Legitimate CDN — hardcode OK |
| `/home/openclaw/projects/cf-router/src/server.js` | 46 | `fonts.gstatic.com` (CSP) | ✓ Legitimate CDN — hardcode OK |

---

## MEDIUM PRIORITY: MAGIC NUMBERS (Timeouts, Intervals, Limits)

### 7. Configuration Magic Numbers — Should Be Named Constants or Env Vars

| File | Line | Value | Context | Verdict |
|------|------|-------|---------|---------|
| `/home/openclaw/projects/cf-router/src/config.js` | 10 | `5000` | Lock file stale timeout (ms) | Named constant: `LOCK_OPTIONS` ✓ |
| `/home/openclaw/projects/cf-router/src/config.js` | 10 | `1000` | Lock update interval (ms) | Named constant: `LOCK_OPTIONS` ✓ |
| `/home/openclaw/projects/cf-router/src/server.js` | 85 | `24 * 60 * 60 * 1000` | Token TTL (24 hours) | Named constant: `TOKEN_TTL_MS` ✓ |
| `/home/openclaw/projects/cf-router/src/server.js` | 93 | `15 * 60 * 1000` | Token cleanup interval | Magic expression — could extract to constant |
| `/home/openclaw/projects/cf-router/src/server.js` | 167 | `15 * 60 * 1000` | Auth rate limit window | Magic expression — could extract |
| `/home/openclaw/projects/cf-router/src/server.js` | 168 | `5` | Auth rate limit max attempts | Magic number — could extract |
| `/home/openclaw/projects/cf-router/src/server.js` | 175 | `60 * 1000` | API rate limit window | Magic expression — could extract |
| `/home/openclaw/projects/cf-router/src/server.js` | 921 | `[80, 443, 3000, 3001, ...]` | Default ports to scan | Should be `process.env.PORTS_TO_SCAN` |
| `/home/openclaw/projects/cf-router/src/watcher.js` | 22 | `1000` | Debounce interval (ms) | Named constant: `DEBOUNCE_MS` ✓ |
| `/home/openclaw/projects/cf-router/src/mcp.js` | 367 | `1500` | Socket timeout (ms) | Magic number — should be configurable |
| `/home/openclaw/projects/cf-router/src/mcp.js` | 454 | `15000` | HTTP request timeout (ms) | Magic number — should be configurable |
| `/home/openclaw/projects/cf-router/src/portless.js` | 55-56 | `4000` / `4999` | Port range start/end | Named constants ✓ |
| `/home/openclaw/projects/cf-router/src/portless.js` | 22 | `5000` | Lock acquire timeout (ms) | Magic number — should be constant |

### 8. HTTP Status Codes (Legitimate)

Status codes like `200`, `400`, `401`, `403`, `404`, `500` are legitimate constants and **should NOT be extracted**.

---

## LOW PRIORITY: LEGITIMATE CONSTANTS (Should Keep Hardcoded)

### 9. Reserved Port Numbers & Protocol Identifiers

| File | Value | Context | Verdict |
|------|-------|---------|---------|
| `/home/openclaw/projects/cf-router/src/cli.js` | 22, 80, 443, 25, 53, 3306, 5432 | Reserved ports to skip | ✓ Legitimate constants |
| `/home/openclaw/projects/cf-router/src/discovery.js` | 80, 443, 22, 21 | Protocol → port mapping | ✓ Legitimate constants |
| `/home/openclaw/projects/cf-router/src/discovery.js` | 4000, 5000, 8000, 8080, 9000, 11434 | Service → port heuristics | ✓ Legitimate constants |
| `/home/openclaw/projects/cf-router/src/portless.js` | 4000-4999 | Portless range | ✓ Legitimate, documented in code |

### 10. Content Types & Protocol Strings (Legitimate)

| File | Value | Context |
|------|-------|---------|
| `/home/openclaw/projects/cf-router/src/cloudflare.js` | `Bearer` | HTTP auth scheme ✓ |
| `/home/openclaw/projects/cf-router/src/cloudflare.js` | `application/json` | Content-Type ✓ |
| `/home/openclaw/projects/cf-router/src/templates.js` | `http_status:404` | Cloudflare tunnel service ✓ |
| `/home/openclaw/projects/cf-router/src/mcp.js` | `2024-11-05` | MCP protocol version ✓ |
| `/home/openclaw/projects/cf-router/src/cloudflare.js` | `cfargotunnel.com` | Cloudflare domain ✓ |

### 11. Regex Patterns & Error Codes (Legitimate)

- `/\d+/` (digit matching)
- `/^[a-zA-Z0-9_.-]+\.yml$/` (filename validation)
- Error codes like `token_expired`, `validation_error`, `rate_limit_exceeded` ✓

---

## SUMMARY TABLE BY SEVERITY

### CRITICAL (Immediate Action)
| Issue | Count | Action |
|-------|-------|--------|
| Exposed API Keys | 1 | Rotate immediately, never commit credentials |
| Exposed Credentials | 2 (.env entries) | Move to secure env vars, use strong defaults |
| Exposed Emails | 1 | Remove from config files |
| Exposed Account/Zone IDs | 3 | Review exposure scope |

### HIGH (Next Priority)
| Issue | Count | Action |
|-------|-------|--------|
| Hardcoded Ports | 16 | Move to env vars, use consistent defaults |
| System Paths (/tmp, /var/log, /etc, /usr) | 5 | Make configurable |
| Weak Default Password | 1 | Enforce strong password generation |

### MEDIUM (Nice-to-Have)
| Issue | Count | Action |
|-------|-------|--------|
| Magic Numbers (Timeouts) | 8 | Extract to named constants at module level |
| Hardcoded Config Paths | 3 | Consider env var alternatives |
| CSP URLs | 5 | OK to hardcode but document |

### LOW (No Action Needed)
| Issue | Count | Reason |
|-------|-------|--------|
| HTTP Status Codes | 28 | Standard protocol constants |
| Port Numbers (Reserved) | 8 | Standard, well-known constants |
| Protocol Strings | 15+ | Standard protocol constants |
| Legitimate APIs | 1 | Only Cloudflare API endpoint |

---

## REMEDIATION ROADMAP

### Phase 1: CRITICAL (Do Today)
```bash
# 1. Immediately rotate Cloudflare API key
# 2. Delete or invalidate: 4bcf5441dd2f3a5afcd3e8feaad145e8fc49a
# 3. Update all backup files to remove credentials
# 4. Create .env.example template without secrets
# 5. Add config.yml and .env to .gitignore (if not already)
```

### Phase 2: HIGH (This Sprint)
```bash
# 1. Extract all hardcoded ports to environment variables:
export CF_ROUTER_PORT=7070          # Server port
export NGINX_PORT=6969              # Nginx listen port
export CF_ROUTER_HOST=0.0.0.0       # Bind address

# 2. Make system paths configurable:
export LOG_DIR=/var/log/cf-router
export NGINX_LOG_DIR=/var/log/nginx

# 3. Remove hardcoded defaults from code:
# - DASHBOARD_PASSWORD='openclaw' → require env var
# - DASHBOARD_USERNAME='openclaw' → allow override
# - Default password in docker-compose.yml → generate at runtime
```

### Phase 3: MEDIUM (Next Sprint)
```bash
# 1. Extract magic numbers to named constants
# 2. Create DEFAULT_CONFIG object with all configurable values
# 3. Document all environment variables in README
```

---

## ENVIRONMENT VARIABLES CHECKLIST

Create `.env.example`:

```bash
# Server
PORT=7070
HOST=0.0.0.0
NODE_ENV=production

# Dashboard
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<generate-strong-password>
AUTH_TOKEN=<generate-jwt-token>

# Nginx
NGINX_PORT=6969
NGINX_LISTEN_ADDRESS=0.0.0.0

# Cloudflare (Never commit)
CF_API_KEY=<your-api-key>
CF_API_TOKEN=<your-api-token>
CF_ACCOUNT_EMAIL=<your-email>

# Paths
LOG_DIR=/var/log/cf-router
NGINX_LOG_DIR=/var/log/nginx
CLOUDFLARED_LOG=/tmp/cloudflared-router.log

# Timeouts (ms)
AUTH_RATE_LIMIT_WINDOW=900000
AUTH_RATE_LIMIT_MAX=5
API_RATE_LIMIT_WINDOW=60000
TOKEN_TTL=86400000
LOCK_TIMEOUT=5000

# Features
CORS_ORIGIN=*
AUTO_BACKUP=true
AUTO_DEPLOY=true
```

---

## Files to Update (Priority Order)

1. **`src/config.js`** — Move hardcoded defaults to env vars
2. **`src/server.js`** — DASHBOARD_PASSWORD/USERNAME, port defaults
3. **`ecosystem.config.js`** — Use env vars for ports
4. **`docker-compose.yml`** — Use env var substitution
5. **`src/tunnel.js`** — Make log path configurable
6. **`.env.example`** — Create template (already exists but incomplete)
7. **`.gitignore`** — Ensure config.yml, .env, backups/ are ignored

---

## Conclusion

**Overall Risk Level:** 🔴 **HIGH**

The codebase has:
- ✓ Good practices with `process.env.HOME` usage
- ✓ No SQL injection vectors
- ✗ **Exposed API credentials in config file**
- ✗ **Hardcoded weak default credentials**
- ✗ **Multiple hardcoded ports throughout**
- ✗ **No environment variable support for key values**

**Recommendation:** Fix Critical issues before any production deployment. The code is well-structured but needs security hardening around credential handling and configuration management.

