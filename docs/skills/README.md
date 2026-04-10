# CF-Router AI Skills

Claude Code skill files for controlling Cloudflare Router via AI agents.

## Available Skills

| Skill | Purpose |
|-------|---------|
| [cf-router-apps](cf-router-apps.md) | Start, stop, restart, configure, and test app processes |
| [cf-router-portless](cf-router-portless.md) | Enable, disable, register, and test portless services |
| [cf-router-mappings](cf-router-mappings.md) | Add, remove, toggle, and list subdomain→port mappings |
| [cf-router-deploy](cf-router-deploy.md) | Generate nginx configs, deploy to Cloudflare, restart tunnels |
| [cf-router-diagnostics](cf-router-diagnostics.md) | Health checks, log tailing, system status |

## Usage

Load any skill in Claude Code with the Skill tool or by referencing the file path.
The CF-Router API runs at `http://localhost:7070` by default. All endpoints require `Authorization: Bearer <token>` if a password is set.
