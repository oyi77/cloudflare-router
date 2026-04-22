# Cloudflare Router

Manage Cloudflare Tunnels, nginx reverse proxies, and DNS records from one place.

One config file → auto-generate nginx + tunnel + DNS records.

## Features

- **Multi-Account Support**: Manage multiple Cloudflare accounts from one dashboard
- **One-Command Setup**: Initialize with your Cloudflare API token
- **Subdomain Management**: Add/remove subdomains pointing to any local port
- **Auto-Generate**: Nginx configs, tunnel ingress rules, DNS records
- **Web Dashboard**: User-friendly UI at `http://localhost:7070`
- **REST API**: Full CRUD with input validation and pagination
- **MCP Server**: AI agent integration (OpenClaw, Claude, etc.)
- **Multi-Domain**: Manage multiple domains from a single API token
- **Multi-Language**: English, Russian, Chinese, Hindi, Indonesian
- **Security**: Helmet headers, rate limiting, IP whitelist/blacklist, auth
- **Monitoring**: Health checks, traffic stats, SSL expiry, port scanner
- **Request Logging**: Detailed access/error logs with analytics
- **Docker Support**: Ready-to-use Dockerfile and docker-compose
- **PWA Support**: Installable as a web app
- **Test Suite**: Jest unit and integration tests

## Installation

### From GitHub Packages (Recommended)

```bash
# Add GitHub Packages registry
echo "@oyi77:registry=https://npm.pkg.github.com" >> ~/.npmrc

# Install
npm install -g @oyi77/cloudflare-router
```

### From npm

```bash
npm install -g cloudflare-router
```

### Using npx

```bash
npx @oyi77/cloudflare-router dashboard
```

### Docker

```bash
git clone https://github.com/oyi77/cloudflare-router.git
cd cloudflare-router
docker-compose up -d
```

## Quick Start

```bash
# Initialize
cloudflare-router init \
  --token "your-cf-api-token" \
  --zone "your-zone-id" \
  --tunnel "your-tunnel-id" \
  --domain "example.com" \
  --credentials "/path/to/tunnel/credentials.json"

# Add mappings
cloudflare-router add api 3002 -d "Backend API"
cloudflare-router add app 3000 -d "Frontend App"
cloudflare-router add admin 3001 -d "Admin Panel"

# Generate configs
cloudflare-router generate

# Deploy DNS records to Cloudflare
cloudflare-router deploy

# Start dashboard
cloudflare-router dashboard
```

## Automatic Config Regeneration (File Watcher)

The file watcher automatically regenerates tunnel configs when mapping files change, eliminating manual regeneration steps.

### Usage

Start the watcher:
```bash
# CLI command
cloudflare-router watcher

# Or npm script
npm run watcher

# Or with PM2 (recommended for production)
npm run pm2:start
```

### How It Works

1. Watches `~/.cloudflare-router/mappings/*.yml` for changes
2. Detects file modifications (add, change, delete)
3. Automatically runs `node src/cli.js generate` on change
4. Logs all activity to `~/.cloudflare-router/logs/watcher.log`
5. Debounces rapid changes (waits 1 second after last change)

### Example Workflow

```bash
# Terminal 1: Start watcher
cloudflare-router watcher

# Terminal 2: Edit mapping file
vim ~/.cloudflare-router/mappings/cf_myzone.yml

# Watcher automatically detects change and regenerates config
# Output: ✓ Config regenerated successfully
```

### PM2 Integration

The watcher runs as a separate PM2 app alongside the main server:

```bash
# Start both server and watcher
npm run pm2:start

# View logs
pm2 logs cf-router-watcher

# Stop watcher
pm2 stop cf-router-watcher

# Restart watcher
pm2 restart cf-router-watcher
```

### Optional: Auto-Sync to Cloudflare

To enable automatic sync to Cloudflare after regeneration, uncomment the sync block in `src/watcher.js`:

```javascript
// Optional: Auto-sync to Cloudflare (uncomment to enable)
try {
  log('Syncing to Cloudflare...', 'info');
  execSync('python3 sync-tunnel-config.py', {
    cwd: ROUTER_DIR,
    encoding: 'utf-8',
    stdio: 'pipe'
  });
  log('Sync completed', 'success');
} catch (syncErr) {
  log(`Sync failed: ${syncErr.message}`, 'warn');
}
```

### Logs

Watcher activity is logged to `~/.cloudflare-router/logs/watcher.log`:

```bash
# View recent watcher logs
tail -f ~/.cloudflare-router/logs/watcher.log

# View via PM2
pm2 logs cf-router-watcher
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Router                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  config.yml ──→ Nginx Generator ──→ nginx.conf              │
│      │              +                                         │
│      │         Tunnel Generator ──→ tunnel/config.yml        │
│      │              +                                         │
│  mappings.yml ──→ DNS API ──→ Cloudflare DNS Records         │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │ CLI          │    │ Web Dashboard│    │ MCP Server   │   │
│  └──────────────┘    └──────────────┘    └──────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘

                │
                ▼
        ┌──────────────┐
        │   Nginx      │
        │   :6969      │
        └──────┬───────┘
               │
               ▼
        ┌──────────────┐
        │  Cloudflare  │
        │    Tunnel    │
        └──────┬───────┘
               │
               ▼
   *.example.com ──→ localhost:PORT
```

## CLI Commands

```
cloudflare-router init           Initialize configuration
cloudflare-router account:add    Add Cloudflare account
cloudflare-router account:list   List all accounts
cloudflare-router add            Add subdomain mapping
cloudflare-router remove         Remove subdomain mapping
cloudflare-router list           List all mappings
cloudflare-router generate       Generate nginx + tunnel configs
cloudflare-router deploy         Deploy DNS records to Cloudflare
cloudflare-router status         Show system status
cloudflare-router watcher        Start file watcher for auto-regeneration
cloudflare-router dashboard      Start web dashboard

# Short alias
cfr dashboard
```

## Shell Auto-Completion

```bash
# Bash
cp completions/cloudflare-router.bash /etc/bash_completion.d/

# Zsh
cp completions/cloudflare-router.zsh /usr/share/zsh/site-functions/_cloudflare-router
```

## API Endpoints

### Accounts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/accounts` | List accounts |
| POST | `/api/accounts` | Add account |
| DELETE | `/api/accounts/:id` | Remove account |
| GET | `/api/accounts/:id/verify` | Verify account credentials |
| GET | `/api/accounts/:id/discover` | Discover zones |
| POST | `/api/accounts/:id/zones` | Add zone to account |
| DELETE | `/api/accounts/:id/zones/:zoneId` | Remove zone |

### Mappings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mappings` | List mappings (supports pagination, filter, sort) |
| POST | `/api/mappings` | Add mapping |
| PUT | `/api/mappings/:account/:zone/:subdomain` | Update mapping |
| PATCH | `/api/mappings/:account/:zone/:subdomain` | Toggle enabled state |
| DELETE | `/api/mappings/:account/:zone/:subdomain` | Remove mapping |

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | System status |
| GET | `/api/stats` | Traffic statistics |
| POST | `/api/generate` | Generate nginx configs |
| POST | `/api/deploy` | Deploy DNS records |

### DNS & SSL
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dns/all` | List all DNS records |
| GET | `/api/ssl/all` | SSL certificates |
| GET | `/api/ssl/:domain` | SSL details for domain |

### Logs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/logs/access?lines=100` | Access logs |
| GET | `/api/logs/errors?lines=100` | Error logs |
| GET | `/api/logs/stats` | Log statistics |
| DELETE | `/api/logs` | Clear logs |

### Security
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ip/lists` | Get whitelist/blacklist |
| POST | `/api/ip/whitelist` | Add IP to whitelist |
| POST | `/api/ip/blacklist` | Add IP to blacklist |
| DELETE | `/api/ip/whitelist/:ip` | Remove from whitelist |
| DELETE | `/api/ip/blacklist/:ip` | Remove from blacklist |

### Query Parameters

**Pagination:**
- `?page=1` - Page number (default: 1)
- `?limit=50` - Items per page (default: 50, max: 100)

**Filtering & Sorting:**
- `?filter=api` - Filter by subdomain/domain/account name
- `?sort=subdomain:asc` - Sort by field (asc/desc)

## API Validation

All POST/PUT endpoints validate input:

| Field | Validation |
|-------|-----------|
| `email` | Valid email format |
| `subdomain` | Alphanumeric + hyphens, 1-63 chars |
| `port` | Integer 1-65535 |
| `domain` | Valid FQDN |
| `ip` | Valid IPv4/IPv6 |

Validation errors return `400` with details:
```json
{
  "error": "Validation failed",
  "code": "validation_error",
  "details": [
    { "field": "subdomain", "message": "Valid subdomain required" }
  ]
}
```

## Security

### Authentication
- Login via `POST /api/auth/login` with `{ password }` in the request body
- On success, returns a cryptographically random 64-character hex token (32 bytes via `crypto.randomBytes`)
- Use the token as `Authorization: Bearer <token>` on subsequent requests
- Tokens are stored in-memory and cleared on server restart

### Input Validation
- App names are validated against `/^[a-zA-Z0-9_-]+$/` (max 128 characters)
- App config updates only accept whitelisted fields: `command`, `script`, `cwd`, `env`, `mode`, `port`, `restartPolicy`, `enabled`, `autoStart`
- Domain names in SSL checks are validated against a strict regex
- Cloudflare config paths must resolve within `~/.cloudflared/`

## Security Features

- **Helmet.js**: Security headers (CSP, HSTS, X-Frame-Options)
- **Rate Limiting**: 
  - Auth endpoints: 5 requests per 15 minutes
  - API endpoints: 100 requests per minute
- **CORS**: Configurable via `CORS_ORIGIN` env var
- **Request Tracing**: `X-Request-ID` header for debugging

## Reliability

### Graceful Shutdown
The server handles SIGTERM gracefully:
1. Stops accepting new connections
2. Waits up to 10 seconds for in-flight requests to complete
3. Sends SIGTERM to all managed app processes, then SIGKILL after 5 seconds
4. Forces exit after 15 seconds if shutdown hangs

### Log Rotation
Access logs are written to `~/.cloudflare-router/access.log`.
- Rotation triggers when the log file exceeds 10MB
- Up to 5 rotated copies are kept (`.log.1` through `.log.5`)

### App Lifecycle
- Apps with `autoStart: true` in `apps.yaml` start automatically on server boot
- `restartPolicy: always` restarts apps on exit (exponential backoff: 1s → 2s → 4s → ... → 30s cap)
- `restartPolicy: on-failure` restarts only on non-zero exit codes
- `restartPolicy: never` (default) does not restart

## MCP Tools (AI Agent Integration)

- `cloudflare_router_list_mappings` - List all mappings
- `cloudflare_router_add_mapping` - Add subdomain mapping
- `cloudflare_router_remove_mapping` - Remove mapping
- `cloudflare_router_toggle_mapping` - Enable/disable mapping
- `cloudflare_router_generate` - Generate configs
- `cloudflare_router_deploy` - Deploy DNS records
- `cloudflare_router_status` - Get status
- `cloudflare_router_list_dns` - List DNS records
- `cloudflare_router_verify_token` - Verify API token
- `cloudflare_router_get_config` - Get config

## Configuration

Config is stored in `~/.cloudflare-router/config.yml`:

```yaml
cloudflare:
  api_token: "your-api-token"
  zone_id: "your-zone-id"
  tunnel_id: "your-tunnel-id"
  tunnel_credentials: "/path/to/credentials.json"
  domain: "example.com"

nginx:
  listen_port: 6969
  config_dir: "~/.cloudflare-router/nginx/sites"

server:
  port: 7070
  host: "0.0.0.0"
```

## Multi-Account Support

Manage multiple Cloudflare accounts:

```yaml
accounts:
  - id: "personal"
    name: "Personal"
    email: "user@gmail.com"
    api_key: "your-api-key"
    zones:
      - zone_id: "zone-id-1"
        domain: "example.com"
        tunnel_id: "tunnel-id-1"

  - id: "work"
    name: "Work"
    email: "user@company.com"
    api_key: "work-api-key"
    zones:
      - zone_id: "zone-id-2"
        domain: "company.com"
        tunnel_id: "tunnel-id-2"
```

## Request Logging

Access logs are stored in `~/.cloudflare-router/logs/`:

- `access.log` - All requests (JSON format)
- `error.log` - 4xx/5xx errors only

View logs via API:
```bash
curl http://localhost:7070/api/logs/access -H "Authorization: Bearer 123456"
curl http://localhost:7070/api/logs/stats -H "Authorization: Bearer 123456"
```

## Environment Variables

```bash
DASHBOARD_PASSWORD=123456        # Dashboard auth password
AUTH_TOKEN=your-token            # API auth token
WEBHOOK_URL=https://...          # Webhook for alerts
CORS_ORIGIN=https://example.com  # CORS origin (default: all)
```

## Testing

Run the full test suite:
```bash
npm test -- --runInBand
```

The `--runInBand` flag prevents flaky failures caused by parallel test suite cleanup of shared fixture directories.

Test files:
- `tests/api.test.js` — API integration tests
- `tests/portless.test.js` — Portless service module tests
- `tests/app-lifecycle.test.js` — App lifecycle API tests
- `tests/mcp.test.js` — MCP tool handler tests
- `tests/watchdog.test.js` — Watchdog restart logic tests
- `tests/auth-flow.test.js` — Auth token flow tests
- `tests/security.test.js` — Input validation unit tests

## Development

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Project Structure

```
src/
├── server.js       # Express API server
├── config.js       # Configuration management
├── cloudflare.js   # Cloudflare API client
├── nginx.js        # Nginx config generator
├── tunnel.js       # Tunnel config generator
├── middleware.js   # Rate limiting & IP filtering
├── logger.js       # Request logging
├── backup.js       # Backup & restore
├── i18n.js         # Internationalization
├── cli.js          # CLI commands
├── mcp.js          # MCP server
└── dashboard/      # Web UI (static files)

tests/
├── config.test.js      # Config unit tests
├── api.test.js         # API integration tests
└── validation.test.js  # Validation tests
```

## License

MIT
