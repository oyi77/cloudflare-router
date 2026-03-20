# Cloudflare Router

Manage Cloudflare Tunnels, nginx reverse proxies, and DNS records from one place.

One config file → auto-generate nginx + tunnel + DNS records.

## Features

- **One-Command Setup**: Initialize with your Cloudflare API token
- **Subdomain Management**: Add/remove subdomains pointing to any local port
- **Auto-Generate**: Nginx configs, tunnel ingress rules, DNS records
- **Web Dashboard**: User-friendly UI at `http://localhost:7070`
- **REST API**: Full CRUD with Swagger docs
- **MCP Server**: AI agent integration (OpenClaw, Claude, etc.)
- **Multi-Domain**: Manage multiple domains from a single API token

## Quick Start

```bash
# Install globally
npm install -g cloudflare-router

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
cloudflare-router init       Initialize configuration
cloudflare-router add        Add subdomain mapping
cloudflare-router remove     Remove subdomain mapping
cloudflare-router list       List all mappings
cloudflare-router generate   Generate nginx + tunnel configs
cloudflare-router deploy     Deploy DNS records to Cloudflare
cloudflare-router status     Show system status
cloudflare-router dns        List Cloudflare DNS records
cloudflare-router dashboard  Start web dashboard
cloudflare-router mcp        Start MCP server
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/config` | Get config |
| PUT | `/api/config` | Update config |
| GET | `/api/mappings` | List mappings |
| POST | `/api/mappings` | Add mapping |
| DELETE | `/api/mappings/:subdomain` | Remove mapping |
| PATCH | `/api/mappings/:subdomain` | Toggle mapping |
| POST | `/api/generate/nginx` | Generate nginx configs |
| POST | `/api/generate/tunnel` | Generate tunnel config |
| POST | `/api/deploy` | Deploy DNS records |
| POST | `/api/full-deploy` | Generate + deploy all |
| GET | `/api/status` | Get status |
| GET | `/api/dns` | List DNS records |
| GET | `/api/verify` | Verify API token |
| GET | `/api/docs/swagger.json` | Swagger spec |

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

## Multi-Domain Support

A single Cloudflare API token can manage multiple domains:

```yaml
domains:
  - domain: "example.com"
    zone_id: "zone-id-1"
    tunnel_id: "tunnel-id-1"
    mappings:
      - subdomain: "api"
        port: 3002
      - subdomain: "app"
        port: 3000

  - domain: "another-example.com"
    zone_id: "zone-id-2"
    tunnel_id: "tunnel-id-2"
    mappings:
      - subdomain: "www"
        port: 8080
```

## License

MIT
