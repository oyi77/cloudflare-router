---
name: cf-router-diagnostics
description: Diagnose CF-Router health — check nginx status, view app logs, run health checks on URLs and services, get system uptime
type: tool
---

# CF-Router: Diagnostics & Health

## Purpose
Check the health of the CF-Router system, services, and managed applications.

## When to Use
- Checking if nginx is running
- Viewing recent logs for an app or the router itself
- Running health checks on mapped domains
- Checking system uptime and request stats
- Testing if a portless service is up and responding

## API Endpoints
- `GET /api/status` — Overall system status (nginx, tunnels, mappings count)
- `GET /api/apps/:name/status` — Single app status and PID
- `GET /api/apps/:name/logs?lines=N` — App log tail
- `POST /api/portless/:name/test` — TCP+HTTP service test
- `GET /api/health-checks` — List all health checks
- `POST /api/health-check/add` — Add a URL health check
- `GET /api/ssl/all` — Check SSL cert expiry for all domains
- `GET /api/logs/access` — Recent access logs
- `GET /api/logs/errors` — Recent error logs

## Steps

### To check overall system health:
1. Call `GET /api/status`
2. Check `nginx.status`, `tunnels`, and `mappings_count`

### To test a specific service:
1. Call `POST /api/portless/<name>/test`
2. `tcp.open: false` → process not running on port
3. `http.ok: false` → process running but returning errors

### To check SSL:
1. Call `GET /api/ssl/all`
2. Look for `daysUntilExpiry < 30` as warning signal
