# Service Control Design

**Date:** 2026-04-10  
**Status:** Approved  
**Scope:** Full service lifecycle control across UI, CLI, MCP, and AI skills

---

## Overview

Add first-class enable/disable/test controls for Portless services and full lifecycle management for App processes. Deliver full parity across four surfaces: Dashboard UI, CLI, MCP tools, and Claude Code AI skills.

---

## Architecture

All four surfaces (UI, CLI, MCP, skills) call the same HTTP API. No surface has special-case logic — they are thin clients over a single source of truth.

```
┌─────────┐  ┌─────┐  ┌─────┐  ┌────────────┐
│ Dashboard│  │ CLI │  │ MCP │  │ AI Skills  │
└────┬─────┘  └──┬──┘  └──┬──┘  └─────┬──────┘
     └───────────┴─────────┴───────────┘
                       │
              ┌────────▼────────┐
              │  CF-Router API  │
              │  (Express HTTP) │
              └────────┬────────┘
                       │
          ┌────────────┴────────────┐
          │         Services        │
          │  portless.js / apps.yaml│
          └─────────────────────────┘
```

---

## New API Endpoints

### Portless Services

| Method | Endpoint | Body | Purpose |
|--------|----------|------|---------|
| `PATCH` | `/api/portless/:name/toggle` | `{ enabled: bool }` | Enable / disable a service |
| `POST` | `/api/portless/:name/test` | — | TCP port check → HTTP health check |

**Test response shape:**
```json
{
  "tcp": { "open": true, "port": 4001 },
  "http": { "status": 200, "ok": true, "latency": 42 }
}
```

### App Lifecycle

| Method | Endpoint | Body | Purpose |
|--------|----------|------|---------|
| `POST` | `/api/apps/:name/restart` | — | Stop then start the app process |
| `PATCH` | `/api/apps/:name/config` | `{ autoStart, restartPolicy }` | Persist boot config |
| `GET` | `/api/apps/:name/logs` | `?lines=N` | Return last N log lines |
| `GET` | `/api/apps/:name/status` | — | Already exists — unchanged |
| `POST` | `/api/apps/:name/start` | — | Already exists — unchanged |
| `POST` | `/api/apps/:name/stop` | — | Already exists — unchanged |

**`restartPolicy` values:** `"always"` | `"on-failure"` | `"never"`

**Config stored in `apps.yaml`** per app:
```yaml
apps:
  my-api:
    hostname: api.local
    mode: proxy
    target: http://localhost:4001
    autoStart: true
    restartPolicy: always
```

---

## UI Changes

### Portless Services Card (Settings → Portless Services)

Each service card gains:
- **Enable/Disable toggle switch** — calls `PATCH /api/portless/:name/toggle`
- **Test button** — calls `POST /api/portless/:name/test`, shows inline result badge
- Test result displayed inline: `TCP ✓ | HTTP 200 ✓` (green), `TCP ✓ | HTTP 503` (yellow), `TCP ✗ closed` (red)

Layout:
```
┌──────────────────────────────────────────────────┐
│  [●] my-service          Port: 4001 → api.local  │
│      Description here                            │
│  [Test]  [Edit]  [Release]                       │
│  TCP ✓  HTTP 200 OK  (42ms)                      │
└──────────────────────────────────────────────────┘
```

### App Lifecycle Panel (Settings → App Lifecycle)

Each app becomes a full control card with:
- **Status badge** — Running (green) / Stopped (red)
- **PID badge** — shown when running
- **Auto-start toggle** — persists `autoStart` to `apps.yaml`
- **Restart policy selector** — always / on-failure / never
- **Action buttons:** Start | Stop | Restart | Test | Logs | Config
- **Test result badge** — inline TCP+HTTP check result
- **Logs modal** — scrollable, colored output replacing the current `alert()`

Layout:
```
┌─────────────────────────────────────────────────────────┐
│  my-api          ● Running   PID: 1234   Auto-start ✓   │
│  port 4001 → api.local                                  │
│  [Start] [Stop] [Restart]  [Test]  [Logs]  [⚙ Config]  │
│  Restart policy: [always ▼]                             │
│  TCP ✓  HTTP 200 OK  (38ms)                             │
└─────────────────────────────────────────────────────────┘
```

**Logs modal:** Scrollable pre-formatted output, auto-scrolls to bottom, Refresh button, Close button. No more `alert()`.

---

## CLI Commands

New commands added to `src/cli.js`:

### App commands
```
app:start <name>              Start an app process
app:stop <name>               Stop an app process
app:restart <name>            Restart an app process
app:status <name>             Show app status, PID, config
app:logs <name> [--lines N]   Tail last N lines of app logs
app:config <name>             Set autoStart / restartPolicy
  --auto-start true|false
  --restart-policy always|on-failure|never
app:test <name>               Run TCP + HTTP test on the app
```

### Portless commands
```
portless:list                 List all portless services
portless:enable <name>        Enable a portless service
portless:disable <name>       Disable a portless service
portless:test <name>          Run TCP + HTTP test on the service
```

---

## MCP Tools

New tools added to `src/mcp.js`:

### App lifecycle tools (7)
- `cf_router_app_start` — start an app by name
- `cf_router_app_stop` — stop an app by name
- `cf_router_app_restart` — restart an app by name
- `cf_router_app_status` — get app status, PID, config
- `cf_router_app_logs` — get last N log lines
- `cf_router_app_config` — set autoStart / restartPolicy
- `cf_router_app_test` — run TCP + HTTP connectivity test

### Portless tools (4)
- `cf_router_portless_list` — list all portless services
- `cf_router_portless_enable` — enable a portless service
- `cf_router_portless_disable` — disable a portless service
- `cf_router_portless_test` — run TCP + HTTP connectivity test

---

## AI Skills (docs/skills/)

Structured as Claude Code skill files (`.md`) so AI agents can control CF-Router natively.

### Files
```
docs/skills/
  README.md                   Index of available skills
  cf-router-apps.md           Manage app lifecycle via AI
  cf-router-portless.md       Manage portless services via AI
  cf-router-mappings.md       Manage subdomain mappings via AI
  cf-router-deploy.md         Deploy and sync Cloudflare configs
  cf-router-diagnostics.md    Health checks, logs, status checks
```

Each skill file follows the Claude Code skill format:
- What it does
- When to use it
- Step-by-step instructions referencing CLI commands / API endpoints
- Example tool calls

---

## Robustness Requirements

- All new API endpoints validate input (`express-validator`)
- All async operations use `asyncHandler` wrapper — no unhandled rejections
- TCP test has 3-second timeout; HTTP test has 5-second timeout
- UI shows loading state during Test (spinner on button)
- CLI outputs structured errors with exit code 1 on failure
- MCP tools return `{ error, code }` on failure matching existing convention
- `autoStart` behavior: on CF-Router server startup, all apps with `autoStart: true` are started automatically
- `restartPolicy: "always"` — watch process exit, restart with exponential backoff (max 30s)

---

## Files to Modify / Create

| File | Change |
|------|--------|
| `src/server.js` | Add 6 new API endpoints |
| `src/portless.js` | Add `enableService`, `disableService`, `testService` |
| `src/cli.js` | Add `app:*` and `portless:enable/disable/test` commands |
| `src/mcp.js` | Add 10 new MCP tools |
| `src/dashboard/index.html` | UI cards for portless + app lifecycle |
| `src/dashboard/styles.css` | Styles for test badge, logs modal |
| `docs/skills/README.md` | Skills index |
| `docs/skills/cf-router-apps.md` | App lifecycle skill |
| `docs/skills/cf-router-portless.md` | Portless skill |
| `docs/skills/cf-router-mappings.md` | Mappings skill |
| `docs/skills/cf-router-deploy.md` | Deploy skill |
| `docs/skills/cf-router-diagnostics.md` | Diagnostics skill |
