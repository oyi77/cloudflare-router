# Cloudflare Router

Manage Cloudflare Tunnels, nginx reverse proxies, and DNS records from one place.

One config file → auto-generate nginx + tunnel + DNS records.

## Features

- **Multi-Account Support**: Manage multiple Cloudflare accounts from one dashboard
- **One-Command Setup**: Initialize with your Cloudflare API token
- **Subdomain Management**: Add/remove subdomains pointing to any local port
- **Auto-Generate**: Nginx configs, tunnel ingress rules, DNS records
- **Web Dashboard**: User-friendly UI at `http://localhost:7070`
- **REST API**: Full CRUD with Swagger docs
- **MCP Server**: AI agent integration (OpenClaw, Claude, etc.)
- **Multi-Domain**: Manage multiple domains from a single API token
- **Multi-Language**: English, Russian, Chinese, Hindi, Indonesian
- **Security**: Rate limiting, IP whitelist/blacklist, auth
- **Monitoring**: Health checks, traffic stats, SSL expiry, port scanner
- **Request Logging**: Detailed access/error logs with analytics
- **Docker Support**: Ready-to-use Dockerfile and docker-compose
- **PWA Support**: Installable as a web app

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

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/accounts` | List accounts |
| POST | `/api/accounts` | Add account |
| DELETE | `/api/accounts/:id` | Remove account |
| GET | `/api/mappings` | List mappings |
| POST | `/api/mappings` | Add mapping |
| GET | `/api/stats` | Traffic statistics |
| GET | `/api/ssl/all` | SSL certificates |
| GET | `/api/health-checks` | Health checks |
| POST | `/api/health-check/add` | Add health check |
| GET | `/api/logs/access` | Access logs |
| GET | `/api/logs/errors` | Error logs |
| GET | `/api/logs/stats` | Log statistics |
| DELETE | `/api/logs` | Clear logs |
| GET | `/api/languages` | Available languages |
| GET | `/api/translations?lang=xx` | Get translations |
| POST | `/api/config/export` | Export config |
| POST | `/api/config/import` | Import config |

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
```

## License

MIT
