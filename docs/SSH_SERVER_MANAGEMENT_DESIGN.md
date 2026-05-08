# CF-Router SSH Server Management Feature Design

## Overview

Enable cf-router to manage routing to services on remote servers via SSH tunnels, eliminating the need to install cf-router on every server.

## Problem Statement

Current architecture requires cf-router (nginx + cloudflared) to be installed on each server that needs to be exposed via Cloudflare. This creates:
- Deployment complexity (install cf-router on every server)
- Configuration duplication (each server has its own mappings)
- Inconsistent routing rules across servers
- Difficult centralized management

## Proposed Solution

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Central CF-Router Server                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Cloudflared  │  │    Nginx     │  │  SSH Tunnel Mgr  │  │
│  │   (tunnel)    │→│   (proxy)    │←│   (connections)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                  │                    │
         │                  │                    │
         ▼                  ▼                    ▼
    Cloudflare         Local Services      SSH Tunnels
    Edge Network       (port XXXX)              │
                                                │
        ┌───────────────────────────────────────┤
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Server A    │   │  Server B    │   │  Server C    │
│  (VPS)       │   │  (Home)      │   │  (Office)    │
│  192.168.1.x │   │  Behind NAT  │   │  Behind NAT  │
└──────────────┘   └──────────────┘   └──────────────┘
```

### How It Works

1. **SSH Reverse Tunnels**: Remote servers initiate SSH connections TO the central cf-router server
2. **Port Forwarding**: Each tunnel forwards a local port on cf-router to a service on the remote server
3. **Dynamic Nginx Config**: cf-router generates nginx configs that proxy to the tunneled ports
4. **Health Monitoring**: Periodic checks ensure tunnels are alive, auto-reconnect if dropped

## Configuration Format

### `servers.yml`

```yaml
servers:
  - name: mt5-vps
    description: MT5 Trading VPS
    host: 192.168.1.100
    ssh_port: 22
    ssh_user: openclaw
    ssh_key: ~/.ssh/id_rsa
    enabled: true
    services:
      - name: mt5-dashboard
        remote_port: 8080
        local_port: 18080
        health_check: /health
        protocol: http

      - name: mt5-api
        remote_port: 8081
        local_port: 18081
        health_check: /api/v1/info
        protocol: http

  - name: home-server
    description: Home Lab Server
    host: home.example.com
    ssh_port: 22
    ssh_user: admin
    ssh_key: ~/.ssh/home_key
    enabled: true
    tunnel_mode: reverse  # Server connects TO us
    services:
      - name: plex
        remote_port: 32400
        local_port: 32400
        protocol: http

      - name: nextcloud
        remote_port: 443
        local_port: 8443
        protocol: https
        ssl_verify: false

  - name: office-server
    description: Office NAS
    host: office.ddns.net
    ssh_port: 2222
    ssh_user: nasadmin
    ssh_key: ~/.ssh/office_key
    enabled: true
    services:
      - name: fileserver
        remote_port: 8080
        local_port: 19080
        protocol: http
```

### Mapping Integration

Extend `mappings.yml` to reference remote services:

```yaml
mappings:
  - subdomain: mt5-prod
    server: mt5-vps
    service: mt5-dashboard
    description: Production MT5 Dashboard
    enabled: true

  - subdomain: home-plex
    server: home-server
    service: plex
    description: Home Plex Server
    enabled: true

  - subdomain: office-files
    server: office-server
    service: fileserver
    description: Office File Server
    enabled: true
```

## Implementation Components

### 1. SSH Tunnel Manager (`tunnel_manager.py`)

```python
class SSHTunnelManager:
    """Manages SSH tunnels to remote servers."""

    def __init__(self, config_path: str):
        self.servers = self.load_config(config_path)
        self.tunnels = {}  # active tunnel processes

    def start_tunnel(self, server: ServerConfig, service: ServiceConfig):
        """Start an SSH reverse tunnel."""
        cmd = [
            "ssh", "-N", "-R",
            f"{service.local_port}:localhost:{service.remote_port}",
            f"{server.ssh_user}@{server.host}",
            "-p", str(server.ssh_port),
            "-i", server.ssh_key,
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=3",
            "-o", "ExitOnForwardFailure=yes",
        ]
        process = subprocess.Popen(cmd)
        self.tunnels[f"{server.name}/{service.name}"] = process

    def check_tunnel(self, tunnel_id: str) -> bool:
        """Check if tunnel is alive."""
        process = self.tunnels.get(tunnel_id)
        return process and process.poll() is None

    def reconnect_tunnel(self, tunnel_id: str):
        """Reconnect a dropped tunnel."""
        # Kill old process, start new one
        pass

    def health_check(self, server: ServerConfig, service: ServiceConfig):
        """HTTP health check on tunneled service."""
        url = f"http://localhost:{service.local_port}{service.health_check}"
        try:
            resp = requests.get(url, timeout=5)
            return resp.status_code == 200
        except:
            return False
```

### 2. Nginx Config Generator (`nginx_generator.py`)

```python
class NginxConfigGenerator:
    """Generates nginx configs for remote services."""

    TEMPLATE = """
server {{
    listen 6969;
    server_name {subdomain}.{domain};

    location / {{
        proxy_pass http://127.0.0.1:{local_port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }}

    location /cf-health {{
        return 200 '{{"status":"ok","service":"{service_name}","server":"{server_name}","remote":true}}';
        add_header Content-Type application/json;
    }}
}}
"""

    def generate(self, mapping: Mapping, server: Server, service: Service) -> str:
        return self.TEMPLATE.format(
            subdomain=mapping.subdomain,
            domain=mapping.domain,
            local_port=service.local_port,
            service_name=service.name,
            server_name=server.name,
        )
```

### 3. Health Monitor (`health_monitor.py`)

```python
class HealthMonitor:
    """Monitors tunnel and service health."""

    def __init__(self, tunnel_mgr: SSHTunnelManager, interval: int = 30):
        self.tunnel_mgr = tunnel_mgr
        self.interval = interval
        self.status = {}

    async def run(self):
        """Main monitoring loop."""
        while True:
            for tunnel_id, tunnel in self.tunnel_mgr.tunnels.items():
                alive = self.tunnel_mgr.check_tunnel(tunnel_id)
                if not alive:
                    logger.warning(f"Tunnel {tunnel_id} is down, reconnecting...")
                    self.tunnel_mgr.reconnect_tunnel(tunnel_id)
                self.status[tunnel_id] = {
                    "alive": alive,
                    "last_check": datetime.now(),
                }
            await asyncio.sleep(self.interval)

    def get_status(self) -> dict:
        """Return health status of all tunnels."""
        return self.status
```

## Security Considerations

### SSH Key Management

1. **Dedicated SSH Keys**: Generate separate keys for each remote server
2. **Restricted Access**: Use `authorized_keys` with forced command:
   ```
   command="/bin/false",no-agent-forwarding,no-pty,no-X11-forwarding ssh-rsa AAAA...
   ```
3. **Key Rotation**: Implement automatic key rotation policy

### Network Security

1. **Firewall Rules**: Only allow SSH from cf-router IP
2. **VPN Option**: Support WireGuard/OpenVPN as alternative to direct SSH
3. **Rate Limiting**: Limit connection attempts per server

### Access Control

1. **RBAC**: Role-based access for server management
2. **Audit Logging**: Log all tunnel connections and disconnections
3. **Alerting**: Notify on tunnel failures or security events

## Remote Server Setup

### Automated Setup Script

```bash
#!/bin/bash
# setup-remote-server.sh

SERVER_NAME=$1
CF_ROUTER_HOST=$2

echo "Setting up $SERVER_NAME for cf-router management..."

# 1. Generate SSH key pair
ssh-keygen -t ed25519 -f ~/.ssh/cf-router-${SERVER_NAME} -N ""

# 2. Add to authorized_keys on remote server
echo "Add this public key to remote server's authorized_keys:"
cat ~/.ssh/cf-router-${SERVER_NAME}.pub

# 3. Test connection
ssh -i ~/.ssh/cf-router-${SERVER_NAME} ${CF_ROUTER_HOST} "echo 'Connection successful'"

# 4. Add to servers.yml
echo "Add the following to servers.yml:"
cat << EOF
  - name: ${SERVER_NAME}
    host: $(hostname -I | awk '{print $1}')
    ssh_port: 22
    ssh_user: $(whoami)
    ssh_key: ~/.ssh/cf-router-${SERVER_NAME}
    enabled: true
    services: []
EOF
```

### Reverse Tunnel Setup (for NAT'd servers)

For servers behind NAT that can't be reached directly:

```bash
# On remote server, add to crontab or systemd:
# Reconnect tunnel every minute if not connected

#!/bin/bash
# keep-tunnel-alive.sh

CF_ROUTER_HOST="cf-router.example.com"
LOCAL_PORT=8080
REMOTE_PORT=18080

while true; do
    if ! pgrep -f "ssh.*${REMOTE_PORT}:localhost:${LOCAL_PORT}" > /dev/null; then
        ssh -N -R ${REMOTE_PORT}:localhost:${LOCAL_PORT} \
            -o ServerAliveInterval=30 \
            -o ServerAliveCountMax=3 \
            -o ExitOnForwardFailure=yes \
            ${CF_ROUTER_HOST}
    fi
    sleep 60
done
```

## Dashboard Integration

### New API Endpoints

```
GET  /api/servers              - List all managed servers
GET  /api/servers/:name        - Get server details
POST /api/servers              - Add new server
PUT  /api/servers/:name        - Update server config
DELETE /api/servers/:name      - Remove server

GET  /api/servers/:name/tunnels      - List tunnels for server
POST /api/servers/:name/tunnels/:id/reconnect - Reconnect tunnel

GET  /api/health/remote        - Health status of all remote services
```

### Dashboard UI

Add "Remote Servers" tab to cf-router dashboard:
- Server list with status indicators
- Service list per server
- Tunnel status (connected/disconnected)
- Latency metrics
- Manual reconnect buttons

## Migration Path

### Phase 1: Core Infrastructure
- [ ] Implement SSH tunnel manager
- [ ] Add servers.yml config support
- [ ] Basic tunnel lifecycle (start/stop/reconnect)

### Phase 2: Integration
- [ ] Nginx config generation for remote services
- [ ] Extend mappings.yml to support remote services
- [ ] Health monitoring and alerting

### Phase 3: Dashboard
- [ ] API endpoints for server management
- [ ] UI for viewing/managing remote servers
- [ ] Metrics and logging

### Phase 4: Advanced Features
- [ ] Auto-discovery of services on remote servers
- [ ] WireGuard/VPN support as SSH alternative
- [ ] Multi-hop tunneling
- [ ] Load balancing across multiple servers

## Benefits

| Benefit | Description |
|---------|-------------|
| Centralized Management | Single point of control for all routing |
| No Remote Installation | Remote servers only need SSH access |
| NAT Traversal | Works with servers behind NAT/firewall |
| Simplified Config | One config file for all servers |
| Easy Scaling | Add new servers without deploying software |
| Unified Monitoring | All health checks in one place |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Single point of failure | Implement cf-router HA (multiple instances) |
| SSH tunnel latency | Use WireGuard for lower latency |
| Security (SSH keys) | Key rotation, restricted authorized_keys |
| Connection drops | Auto-reconnect with exponential backoff |
| Complex debugging | Comprehensive logging and metrics |

## Conclusion

This feature transforms cf-router from a single-server router into a multi-server routing platform. By leveraging SSH tunnels, we can manage routing to any server without requiring software installation on remote machines. This is especially valuable for:
- Home servers behind NAT
- VPS instances from different providers
- Office servers with restricted access
- IoT devices with limited capabilities
