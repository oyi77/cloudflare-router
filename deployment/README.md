# CF-Router

Unified routing for all OpenClaw applications. Supports three modes: **port**, **socket**, and **portless**.

## Architecture

```
Internet (HTTPS)
    ↓
Cloudflare Tunnel (cloudflared-tunnel)
    ↓
nginx:6969 (CF-Router)
    ↓
[port] → http://localhost:{port}
[socket] → unix:{socket_path}
[portless] → http://appname.localhost
```

## Quick Start

### 1. View current apps
```bash
cf-router status
```

### 2. Add a new app

**Port mode** (traditional):
```bash
cf-router add myapp port 8080
```

**Socket mode** (no port conflicts):
```bash
cf-router add myapp socket
```

**Portless mode** (auto-assigned):
```bash
cf-router add myapp portless
```

### 3. Reload after changes
```bash
cf-router reload
```

## App Configuration

All apps are defined in `~/.cloudflare-router/apps.yaml`:

```yaml
apps:
  myapp:
    mode: port          # port | socket | portless
    hostname: myapp.aitradepulse.com
    host: 127.0.0.1     # for port mode
    port: 8080          # for port mode
    path: /tmp/myapp.sock  # for socket mode
    health_check: /     # health check endpoint
    enabled: true
    no_tls_verify: false  # for backends with self-signed certs
```

## Running Apps

### Port Mode
Traditional port-based:
```bash
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8080
```

### Socket Mode
Using Unix socket (no port conflicts):
```bash
python3 -m uvicorn app.main:app --factory --unix-socket /tmp/myapp.sock
```

### Portless Mode
Auto-assigned port via portless:
```bash
portless myapp python3 -m uvicorn app.main:app
# → http://myapp.localhost
```

## Commands

| Command | Description |
|---------|-------------|
| `cf-router status` | Show all apps and health status |
| `cf-router generate` | Generate nginx configs |
| `cf-router reload` | Generate + reload nginx |
| `cf-router discover` | Discover portless apps |
| `cf-router add <name> <mode>` | Add a new app |
| `cf-router remove <name>` | Remove an app |

## Benefits

- **No port conflicts**: Use socket or portless mode
- **Single entry point**: All apps via nginx:6969
- **Unified management**: One config file for all apps
- **Auto-discovery**: Portless apps auto-detected
- **Health monitoring**: Built-in health checks

## Troubleshooting

### Check nginx status
```bash
sudo systemctl status nginx
```

### View nginx logs
```bash
sudo tail -f /var/log/nginx/cloudflare-router-error.log
```

### Test routing locally
```bash
curl http://localhost:6969/ -H "Host: myapp.aitradepulse.com"
```

### Check app health
```bash
curl http://localhost:6969/cf-health -H "Host: myapp.aitradepulse.com"
```

## File Structure

```
~/.cloudflare-router/
├── apps.yaml              # App registry config
├── cf-router              # Manager script
├── nginx/
│   ├── nginx.conf         # Generated main config
│   └── sites/             # Generated site configs
└── deployment/            # Deployment scripts
```
