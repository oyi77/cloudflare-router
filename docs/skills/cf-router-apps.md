---
name: cf-router-apps
description: Manage app lifecycle in Cloudflare Router — start, stop, restart, configure auto-start and restart policy, view logs, and test connectivity
type: tool
---

# CF-Router: App Lifecycle Management

## Purpose
Control application processes managed by CF-Router. Apps are defined in `~/.cloudflare-router/apps.yaml`.

## When to Use
- Starting or stopping a specific application
- Restarting an app after config changes
- Configuring auto-start on boot or restart policy
- Viewing recent app logs
- Testing if an app's port is reachable

## API Endpoints
- `POST /api/apps/:name/start` — Start an app
- `POST /api/apps/:name/stop` — Stop an app
- `POST /api/apps/:name/restart` — Restart an app
- `PATCH /api/apps/:name/config` — Set autoStart and restartPolicy
- `GET /api/apps/:name/status` — Get status, PID, config
- `GET /api/apps/:name/logs?lines=N` — Get last N log lines
- `POST /api/portless/:name/test` — TCP+HTTP connectivity test

## CLI Commands
```bash
cf-router app:start <name>
cf-router app:stop <name>
cf-router app:restart <name>
cf-router app:status <name>
cf-router app:logs <name> --lines 50
cf-router app:config <name> --auto-start true --restart-policy always
cf-router app:test <name>
```

## Steps

### To start an app:
1. Call `POST /api/apps/<name>/start`
2. Check response for `{ success: true, pid: N }`

### To configure auto-start:
1. Call `PATCH /api/apps/<name>/config` with body `{ "autoStart": true, "restartPolicy": "always" }`
2. Valid restartPolicy values: `"always"`, `"on-failure"`, `"never"`

### To view logs:
1. Call `GET /api/apps/<name>/logs?lines=100`
2. Response: `{ logs: ["line1", "line2", ...] }`

### To test connectivity:
1. Call `POST /api/portless/<name>/test`
2. Response: `{ tcp: { open, port }, http: { status, ok, latency } }`
