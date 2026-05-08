# CF-Router Enhancement Plan

> **Version:** 1.0  
> **Date:** 2026-04-02  
> **Status:** Draft — awaiting approval  
> **Target:** Cloudflare Router v3.0.0

---

## Executive Summary

CF-Router saat ini sudah functional sebagai Cloudflare tunnel orchestrator dengan dashboard, CLI, dan MCP integration. Plan ini mendokumentasikan **5 enhancements + bonus items** yang akan menaikkan maturity level dari "works" ke "production-grade enterprise tool."

**Prioritas Eksekusi:** Phase 1 → 2 → 3 → 4 (sequential, each phase depends on previous)

---

## Phase 1: Testing & Quality Foundation 🔴 CRITICAL

**Estimasi:** 3-5 hari  
**Risk:** Low  
**Impact:** High — enables safe refactoring in Phase 2

### 1.1 Testing Framework Setup

#### What
- Install **Jest** + **supertest** + **ts-jest** (jika nanti migrate ke TS)
- Setup `jest.config.js` dengan coverage thresholds
- Create `__tests__/` directory structure

#### Why
- Tidak ada test automation saat ini → tidak ada safety net untuk refactor
- Coverage minimum 70% sebelum merge ke main
- Prevent regression bugs

#### How
```bash
# Install dependencies
npm install --save-dev jest supertest cross-env
npm run test -- --coverage
```

**Directory Structure:**
```
__tests__/
├── unit/
│   ├── config.test.js        # Config validation
│   ├── i18n.test.js          # Translation logic
│   ├── logger.test.js        # Logger output
│   └── middleware.test.js    # Auth, rate-limit, helmet
├── integration/
│   ├── server.test.js        # HTTP routing
│   ├── api.test.js           # REST endpoints
│   └── nginx.test.js         # Config generation
├── e2e/
│   ├── dashboard.test.js     # Full dashboard flow
│   └── cli.test.js           # CLI commands
└── mocks/
    ├── cloudflare.js         # Mock CF API
    └── nginx.js              # Mock nginx responses
```

**Test Examples:**
```javascript
// __tests__/unit/config.test.js
describe('Config Validation', () => {
  test('rejects invalid API key format', () => {
    expect(() => validateConfig({ apiKey: 'short' })).toThrow()
  })
  test('accepts valid config', () => {
    const result = validateConfig(validConfig)
    expect(result.valid).toBe(true)
  })
})

// __tests__/integration/api.test.js
describe('REST API', () => {
  test('POST /api/mappings creates new mapping', async () => {
    const res = await request(app)
      .post('/api/mappings')
      .send({ subdomain: 'test', port: 8080 })
    expect(res.status).toBe(201)
    expect(res.body.subdomain).toBe('test')
  })
})
```

**Coverage Thresholds:**
| Category | Minimum |
|----------|---------|
| Lines | 70% |
| Functions | 75% |
| Branches | 65% |
| Statements | 70% |

### 1.2 Linting & Formatting

#### What
- Setup **ESLint** + **Prettier**
- Add pre-commit hooks with **husky**
- Auto-format on `npm run lint:fix`

#### How
```json
// package.json scripts
{
  "scripts": {
    "lint": "eslint src/**/*.js",
    "lint:fix": "eslint src/**/*.js --fix",
    "format": "prettier --write \"src/**/*.js\"",
    "test": "jest --coverage",
    "test:watch": "jest --watch"
  }
}
```

### 1.3 Error Handling Standardization

#### What
- Replace raw `res.status(500).send(err)` dengan centralized error handler
- Create `src/errors/` dengan custom error classes
- Add request ID tracing untuk debugging

#### Custom Error Classes:
```javascript
// src/errors/index.js
class CFRouterError extends Error {
  constructor(message, code, statusCode = 500) {
    super(message)
    this.code = code
    this.statusCode = statusCode
  }
}

class ConfigError extends CFRouterError {
  constructor(message) { super(message, 'CONFIG_ERROR', 400) }
}
class CloudflareAPIError extends CFRouterError {
  constructor(message) { super(message, 'CF_API_ERROR', 502) }
}
class NginxError extends CFRouterError {
  constructor(message) { super(message, 'NGINX_ERROR', 500) }
}
```

---

## Phase 2: Server Refactoring & Modularization 🔴 HIGH

**Estimasi:** 5-7 hari  
**Risk:** Medium — depends on Phase 1 tests passing  
**Impact:** High — maintainability dan developer experience

### 2.1 Split Monolithic `server.js` (1134 lines)

#### Current State
```
server.js (1134 lines) — does EVERYTHING:
  ├── Express setup
  ├── Auth middleware
  ├── REST API routes
  ├── WebSocket handler
  ├── Static file serving
  └── Startup sequence
```

#### Target State
```
src/
├── server.js              # Entry point only (~50 lines)
├── app.js                 # Express app setup (~100 lines)
├── routes/
│   ├── index.js           # Route aggregator
│   ├── accounts.js        # /api/accounts
│   ├── domains.js         # /api/domains
│   ├── mappings.js        # /api/mappings
│   ├── dns.js             # /api/dns
│   ├── tunnels.js         # /api/tunnels
│   ├── health.js          # /api/health
│   ├── traffic.js         # /api/traffic
│   ├── ports.js           # /api/ports
│   ├── nginx.js           # /api/nginx
│   ├── routing.js         # /api/routing
│   ├── settings.js        # /api/settings
│   └── ws.js              # WebSocket handler
├── services/
│   ├── cloudflare.js      # CF API operations
│   ├── nginx.js           # Nginx config generation
│   ├── tunnel.js          # Tunnel management
│   ├── backup.js          # Backup/restore
│   ├── error-pages.js     # Custom error pages
│   └── discovery.js       # Port discovery
├── middleware/
│   ├── auth.js            # Password auth
│   ├── rate-limit.js      # Rate limiting
│   ├── logger.js          # Request logging
│   └── error-handler.js   # Centralized error handler
└── utils/
    ├── validator.js       # Input validation
    └── helpers.js         # Shared utilities
```

### 2.2 Dependency Injection Pattern

#### Why
- Testing jadi lebih mudah (mock dependencies)
- Loose coupling antara modules
- Easier to swap implementations

#### Example:
```javascript
// Before (tightly coupled)
const cloudflare = require('./cloudflare')
const nginx = require('./nginx')
const tunnel = require('./tunnel')

// After (injected)
class RouterService {
  constructor({ cloudflareClient, nginxManager, tunnelManager }) {
    this.cf = cloudflareClient
    this.nginx = nginxManager
    this.tunnel = tunnelManager
  }
  
  async deployAll() {
    // Uses injected dependencies
  }
}

// In app.js:
const routerService = new RouterService({
  cloudflareClient: createCloudflareClient(config),
  nginxManager: new NginxManager(config.nginx),
  tunnelManager: new TunnelManager(config.tunnels)
})
```

### 2.3 API Versioning

#### Why
- Breaking changes tanpa break existing clients
- Clear contract for integrations (MCP, dashboards)

#### How
- Prefix routes dengan `/api/v1/`
- Keep backward compatibility
- Document API in `docs/API.md`

### 2.4 Request Validation Layer

#### What
- Add **Joi** or **Zod** for request body/query validation
- Replace manual `if (!body.field)` checks dengan schema validators

```javascript
// validation/mappings.js
const mappingSchema = Joi.object({
  subdomain: Joi.string()
    .pattern(/^[a-z0-9-]+$/)
    .max(63)
    .required(),
  port: Joi.number().integer().min(1).max(65535).required(),
  zoneId: Joi.string().required(),
  accountId: Joi.string().required(),
  description: Joi.string().max(500).optional()
})

// Usage in route
router.post('/api/v1/mappings',
  validate(mappingSchema),
  mappingsController.create
)
```

---

## Phase 3: Monitoring & Metrics 🟡 MEDIUM

**Estimasi:** 3-4 hari  
**Risk:** Low  
**Impact:** Medium — operational visibility

### 3.1 Prometheus Metrics Endpoint

#### What
- Add `/metrics` endpoint exposing Prometheus-format metrics
- Track: requests, errors, latency, uptime, tunnel status

#### Metrics to Expose:
```
# HELP cf_router_requests_total Total HTTP requests
# TYPE cf_router_requests_total counter
cf_router_requests_total{method="POST", path="/api/mappings"} 142

# HELP cf_router_request_duration_seconds Request duration
# TYPE cf_router_request_duration_seconds histogram
cf_router_request_duration_seconds_bucket{le="0.1"} 85

# HELP cf_router_tunnels_active Active tunnel connections
# TYPE cf_router_tunnels_active gauge
cf_router_tunnels_active{name="app1"} 1

# HELP cf_router_nginx_config_reloads_total Nginx reload count
# TYPE cf_router_nginx_config_reloads_total counter
cf_router_nginx_config_reloads_total 23

# HELP cf_router_cloudflare_api_errors_total CF API errors
# TYPE cf_router_cloudflare_api_errors_total counter
cf_router_cloudflare_api_errors_total{status="5xx"} 2
```

### 3.2 Health Check System

#### Endpoints:
| Endpoint | Purpose |
|----------|---------|
| `/health/live` | Liveness probe — is process running? |
| `/health/ready` | Readiness probe — can handle traffic? |
| `/health/ready` | Checks: CF API connectivity, Nginx status, DB/file system |

#### Implementation:
```javascript
// services/health.js
class HealthChecker {
  async checkReadiness() {
    const checks = {
      cloudflare: await this.checkCFApi(),
      nginx: await this.checkNginx(),
      disk: await this.checkDiskSpace(),
      memory: await this.checkMemory()
    }
    
    const healthy = Object.values(checks).every(c => c.ok)
    return {
      status: healthy ? 'ready' : 'degraded',
      checks,
      timestamp: Date.now()
    }
  }
}
```

### 3.3 Structured Logging (JSON)

#### Current
```
[INFO] 2026-04-02 14:00:00 - Dashboard: http://localhost:7070
```

#### After
```json
{
  "level": "info",
  "timestamp": "2026-04-02T14:00:00.000Z",
  "service": "cf-router",
  "event": "startup",
  "dashboard_url": "http://localhost:7070",
  "version": "2.3.0"
}
```

#### Benefits:
- Bisa query dengan **jq** atau ingest ke ELK/Grafana Loki
- Request tracing dengan correlation IDs
- Audit trail untuk compliance

### 3.4 Alert Rules (Integrasi dengan Notifier)

#### Alert Conditions:
| Condition | Severity | Action |
|-----------|----------|--------|
| Process down | Critical | Telegram webhook + email |
| 5+ errors in 5 min | Warning | Telegram notification |
| Tunnel disconnected | Critical | Auto-retry + notify |
| Disk > 90% | Warning | Telegram notification |
| CF API rate limit hit | Warning | Backoff logging |

---

## Phase 4: Feature Enhancements 🟡 MEDIUM

**Estimasi:** 5-7 hari  
**Risk:** Medium  
**Impact:** High — new capabilities

### 4.1 Role-Based Access Control (RBAC)

#### Current
- Single password untuk semua akses

#### Proposed
```javascript
// Config
auth: {
  admin: {
    password: process.env.CF_ROUTER_ADMIN_PASSWORD,
    permissions: ['read', 'write', 'admin']
  },
  operator: {
    password: process.env.CF_ROUTER_OPERATOR_PASSWORD,
    permissions: ['read', 'write']
  },
  viewer: {
    password: process.env.CF_ROUTER_VIEWER_PASSWORD,
    permissions: ['read']
  }
}
```

#### Permission Matrix:
| Action | Admin | Operator | Viewer |
|--------|-------|----------|--------|
| View dashboard | ✅ | ✅ | ✅ |
| Add/modify accounts | ✅ | ✅ | ❌ |
| Deploy mappings | ✅ | ✅ | ❌ |
| Delete accounts | ✅ | ❌ | ❌ |
| View logs | ✅ | ✅ | ✅ |
| System config | ✅ | ❌ | ❌ |
| Backup/restore | ✅ | ❌ | ❌ |

### 4.2 Multi-Account Rate Limiting

#### Current
- Global rate limit untuk semua accounts

#### Proposed
```javascript
// Per-account rate limits
rateLimits: {
  default: { windowMs: 60000, maxRequests: 100 },
  premium: { windowMs: 60000, maxRequests: 500 },
  enterprise: { windowMs: 1000, maxRequests: 1000 }
}
```

### 4.3 Blue-Green Deployment Support

#### Why
- Zero-downtime routing changes
- Rollback dalam 1 klik

#### Flow:
```
1. Deploy to "green" slot
2. Health check passes
3. Switch traffic from blue → green
4. Keep blue as fallback for 15 minutes
5. Auto-cleanup blue slot
```

### 4.4 WebSocket Real-Time Dashboard Updates

#### Current
- Poll-based (refresh setiap 30 detik)

#### Proposed
- WebSocket push untuk:
  - Tunnel status changes
  - New health check results
  - Metrics updates
  - Config change notifications

### 4.5 Audit Log Viewer

#### What
- Immutable log of all administrative actions
- Filterable by date, user, action type
- Export ke CSV/JSON

#### Actions Logged:
```
[2026-04-02 14:20:00] User=admin | Action=CREATE_MAPPING | 
  Target=test.mydomain.com:8080 | IP=192.168.1.100 | Status=SUCCESS
```

### 4.6 CLI Improvements — Interactive Wizard

#### Current CLI
```bash
cf-router add <name> <mode> [options]
```

#### Enhanced CLI
```bash
cf-router wizard     # Interactive setup
cf-router status     # Show all apps (enhanced)
cf-router logs       # View real-time logs
cf-router metrics    # Show Prometheus metrics
cf-router health     # Full health check
cf-router backup     # One-click backup
cf-router restore    # Restore from backup
```

---

## Bonus: CI/CD & Automation 🟢 NICE-TO-HAVE

**Estimasi:** 2-3 hari  
**Risk:** Low  
**Impact:** Medium — developer productivity

### 5.1 GitHub Actions CI/CD

```yaml
# .github/workflows/ci.yml
name: CI/CD
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run lint
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v3

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd ~/.cloudflare-router
            git pull origin main
            npm ci --production
            pm2 reload cloudflare-router
```

### 5.2 Automatic Changelog Generator

```json
// package.json
{
  "scripts": {
    "release": "standard-version",
    "changelog": "conventional-changelog -p angular -i CHANGELOG.md -s"
  }
}
```

### 5.3 Docker Support

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY src/ ./src/
COPY dashboard/ ./dashboard/
EXPOSE 7070
CMD ["npm", "start"]
```

**Benefits:**
- Consistent environment
- Easy scaling
- Integration dengan Kubernetes

---

## Implementation Roadmap

### Timeline Overview

| Phase | Duration | Dependencies | Deliverables |
|-------|----------|-------------|--------------|
| **Phase 1** | 3-5 days | None | Tests, ESLint, Error handling |
| **Phase 2** | 5-7 days | Phase 1 (tests) | Modular structure, DI, Validation |
| **Phase 3** | 3-4 days | Phase 2 | Metrics, Health, Logging |
| **Phase 4** | 5-7 days | Phase 2-3 | RBAC, Rate limiting, Features |
| **Bonus** | 2-3 days | All | CI/CD, Docker |

**Total Estimate:** 18-26 working days

---

## Success Criteria

| Metric | Before | After |
|--------|--------|-------|
| Test Coverage | 0% | ≥70% |
| Lines per File (avg) | ~300 | ≤150 |
| Error Logging | Raw strings | Structured JSON |
| Access Control | Single password | 3 role levels |
| Health Monitoring | None | Live + Ready probes |
| Deployment | Manual | CI/CD pipeline |
| Rate Limiting | Global | Per-account |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Breaking current functionality | Medium | High | Comprehensive tests first (Phase 1) |
| Performance regression | Low | Medium | Benchmark before/after |
| Complexity increase | Medium | Medium | Keep modules focused, document well |
| Time overrun | Medium | Low | Phased approach, each phase independently valuable |

---

## Approval

- [ ] Phase 1 approved
- [ ] Phase 2 approved  
- [ ] Phase 3 approved
- [ ] Phase 4 approved
- [ ] Bonus items approved

---

*Document created: 2026-04-02 14:25 GMT+7*  
*Author: Vilona (AI)*  
*Status: Draft — awaiting review*
