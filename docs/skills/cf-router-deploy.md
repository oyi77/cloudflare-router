---
name: cf-router-deploy
description: Deploy CF-Router configurations — generate nginx configs, sync to Cloudflare DNS and tunnel ingress, reload nginx, restart tunnels
type: tool
---

# CF-Router: Deploy & Sync

## Purpose
Deploy current mapping configuration to nginx and Cloudflare. Run after adding or changing mappings.

## When to Use
- After adding or removing mappings
- After changing tunnel configuration
- When nginx needs to be reloaded
- When Cloudflare DNS records need syncing

## API Endpoints
- `POST /api/generate` — Generate all nginx + tunnel configs
- `POST /api/nginx/reload` — Reload nginx with new configs
- `POST /api/deploy` — Deploy DNS records to Cloudflare
- `POST /api/tunnel/restart` — Restart a specific tunnel
- `POST /api/tunnel/restart-all` — Restart all tunnels

## CLI Commands
```bash
cf-router generate
cf-router deploy
cf-router nginx:reload
```

## Steps

### Full deploy flow:
1. `POST /api/generate` — builds nginx + tunnel config files
2. `POST /api/nginx/reload` — nginx picks up new config
3. `POST /api/deploy` — pushes DNS records to Cloudflare API

### After adding a mapping:
1. Always run generate → reload → deploy in that order
2. Verify with `GET /api/status`
