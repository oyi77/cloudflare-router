---
name: cf-router-mappings
description: Manage subdomain-to-port mappings in CF-Router — add, remove, toggle enable/disable, list all mappings
type: tool
---

# CF-Router: Subdomain Mapping Management

## Purpose
Mappings connect a subdomain (e.g. `api.example.com`) to a local port. Changes are synced to nginx and Cloudflare tunnel config.

## When to Use
- Adding a new subdomain mapping for a service
- Removing a mapping that's no longer needed
- Enabling or disabling a mapping without deleting it
- Listing all current mappings

## API Endpoints
- `GET /api/mappings` — List all mappings
- `POST /api/mappings` — Add a mapping
- `DELETE /api/mappings/:account/:zone/:subdomain` — Remove a mapping
- `PATCH /api/mappings/:account/:zone/:subdomain/toggle` — Enable or disable
- `POST /api/generate` — Regenerate nginx + tunnel config after changes

## CLI Commands
```bash
cf-router mapping:add --subdomain api --port 4001 --account <id> --zone <id>
cf-router mapping:remove --subdomain api --account <id> --zone <id>
cf-router mapping:toggle --subdomain api --account <id> --zone <id> --enabled true
cf-router mapping:list
cf-router generate
```

## Steps

### To add a mapping:
1. Call `POST /api/mappings` with body `{ "account_id": "...", "zone_id": "...", "subdomain": "api", "port": 4001 }`
2. Then call `POST /api/generate` to regenerate nginx config
3. Then call `POST /api/nginx/reload` to apply changes

### To toggle a mapping:
1. Call `PATCH /api/mappings/<account>/<zone>/<subdomain>/toggle` with body `{ "enabled": false }`
