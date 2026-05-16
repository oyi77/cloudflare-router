<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-17 | Updated: 2026-05-17 -->

# cf-router

## Purpose
Cloudflare traffic router. Manages DNS routing, proxy mappings, tunnel configurations, and error handling for Cloudflare-protected domains and services.

## Key Files
| File | Description |
|------|-------------|
| `package.json` | Dependencies and scripts |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `src/` | Application source code |
| `nginx/` | Nginx configuration templates |
| `mappings/` | Route and domain mappings |
| `deployment/` | Deployment configurations |
| `tunnel/` | Cloudflare Tunnel configuration |
| `state/` | Runtime state storage |
| `tests/` | Test suites |

## For AI Agents

### Working In This Directory
- Independent project
- cd into this directory before running commands

### Testing Requirements
- Verify routing rules and proxy mappings
- Test tunnel connectivity

## Dependencies

### Internal
None — standalone repository

### External
- Node.js — Core runtime
- Cloudflare API — DNS and tunnel management
- Nginx — Reverse proxy
