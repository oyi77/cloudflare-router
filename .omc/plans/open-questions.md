# Open Questions

## security-reliability-remediation — 2026-04-10

- [ ] Should auth tokens have an expiry (e.g., 24h TTL with refresh)? — Affects token storage design in Gap 2. Current plan uses in-memory Map; expiry would add complexity but improve security.
- [ ] Should `PUT /api/apps` (bulk overwrite, line 592) be removed entirely or restricted to admin-only? — It overwrites the entire apps.yaml which is a destructive operation. The per-app endpoint (line 600) is safer.
- [ ] What is the acceptable log retention period beyond the 5-file/10MB rotation? — Affects Gap 11 implementation. Current plan says 5 files x 10MB = 50MB max.
- [ ] Should `validateAppName()` also be applied to HTTP route params (e.g., `PUT /api/apps/:name`)? — Currently only specified for MCP handlers; HTTP routes should also validate.
- [ ] For Gap 15 (MCP -> HTTP routing), should MCP handlers call the HTTP endpoints via localhost or share function references directly? — Function references are simpler but couple the modules; HTTP calls are cleaner but add latency.
