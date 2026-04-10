---
name: cf-router-portless
description: Manage portless services in CF-Router — register services, enable/disable, test TCP+HTTP connectivity, list all services
type: tool
---

# CF-Router: Portless Service Management

## Purpose
Portless services are auto-assigned ports in the range 4000-4999 and mapped to local subdomains. No manual port management needed.

## When to Use
- Registering a new service to get an auto-assigned port
- Enabling or disabling a service
- Testing if a service's port is open and responding
- Listing all registered services and their ports

## API Endpoints
- `GET /api/portless` — List all services
- `POST /api/portless` — Register a new service
- `DELETE /api/portless/:name` — Release a service
- `PATCH /api/portless/:name/toggle` — Enable or disable a service
- `POST /api/portless/:name/test` — TCP+HTTP connectivity test

## CLI Commands
```bash
cf-router portless:list
cf-router portless:register --name my-service --subdomain my-sub --description "My service"
cf-router portless:enable <name>
cf-router portless:disable <name>
cf-router portless:test <name>
```

## Steps

### To register a new service:
1. Call `POST /api/portless` with body `{ "name": "my-service", "subdomain": "my-sub", "description": "..." }`
2. Response includes the auto-assigned port

### To enable/disable a service:
1. Call `PATCH /api/portless/<name>/toggle` with body `{ "enabled": true }` or `{ "enabled": false }`

### To test a service:
1. Call `POST /api/portless/<name>/test`
2. Response: `{ tcp: { open, port }, http: { status, ok, latency } }`
3. If `tcp.open` is false, the service process is not running on its assigned port
