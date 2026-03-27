# Cloudflare Router Improvements Plan

## TL;DR

> **Quick Summary**: Fix auth dashboard failures, add pm2 process manager, create WYSIWYG error page editor, and modernize the UI with responsive design.

> **Deliverables**:
> - Auth system with proper error handling and logging
> - pm2 ecosystem.config.js with restart policies
> - Error page management API + WYSIWYG editor in dashboard
> - Complete UI overhaul with modern design system

> **Estimated Effort**: Medium-Large
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Auth fixes → PM2 setup → Error pages → UI overhaul

---

## Context

### Original Request
User reported 4 major issues with their Cloudflare Router:
1. Auth dashboard failing silently (login doesn't work)
2. Service doesn't survive reboot (using systemd poorly)
3. No settings page with WYSIWYG editor for error pages
4. UI/UX looks bad and not user friendly

### Interview Summary
**Key Discussions**:
- Auth Issue: Login doesn't work - password entered but nothing happens
- Current: Using systemd but not working well for restart/reboot
- Preference: pm2 for better Node.js integration
- Error pages: Full suite needed (404, 500, 502, 503) with WYSIWYG
- UI: Complete overhaul - modern look, better nav, mobile-friendly
- Tests: Should add tests for new features

### Research Findings
- Project is Node.js Express app at `src/server.js`
- Dashboard is single HTML file at `src/dashboard/index.html` with inline CSS
- Auth uses simple password comparison (server.js lines 116-130)
- No pm2 config exists in the repo
- Error pages are static HTML files in `src/errors/` (404.html, 503.html)
- Existing tests in `tests/` folder (config.test.js, api.test.js, validation.test.js)

---

## Work Objectives

### Core Objective
Transform Cloudflare Router from a basic tool into a production-ready application with reliable auth, robust process management, customizable error pages, and a modern user interface.

### Concrete Deliverables
- Fixed auth system with error logging
- pm2 ecosystem configuration with auto-restart
- Error page management API (GET/PUT /api/error-pages/:code)
- WYSIWYG editor in Settings tab for editing error pages
- Complete dashboard UI overhaul with responsive design

### Definition of Done
- [ ] Login flow works with proper error messages
- [ ] pm2 ecosystem.config.js created and tested
- [ ] Service survives reboot via pm2
- [ ] Error pages editable via WYSIWYG editor
- [ ] UI is modern, responsive, and user-friendly
- [ ] Tests pass for new features

### Must Have
- Proper auth error handling and logging
- pm2 with restart policies (restart delay, max restarts, exp backoff)
- Error page CRUD API endpoints
- WYSIWYG editor component in dashboard
- Responsive modern UI design

### Must NOT Have (Guardrails)
- Don't break existing API endpoints
- Don't delete existing test files
- Don't change the core routing functionality
- Don't modify nginx configuration generation logic

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: Tests-after (add new tests after implementation)
- **Framework**: jest (already configured in package.json)

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario}.{ext}`.

- **API Testing**: Use Bash with curl to test endpoints
- **UI Testing**: Use Playwright to verify dashboard loads and interactions work
- **PM2 Testing**: Use Bash to verify pm2 process management

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - Auth + Infrastructure):
├── Task 1: Fix auth system with error logging
├── Task 2: Create pm2 ecosystem.config.js
├── Task 3: Add pm2 startup/shutdown scripts
└── Task 4: Create systemd migration guide

Wave 2 (Error Pages):
├── Task 5: Add error page storage API
├── Task 6: Create error page GET/PUT endpoints
├── Task 7: Add WYSIWYG editor component
├── Task 8: Integrate editor into Settings tab
└── Task 9: Add error page tests

Wave 3 (UI Overhaul):
├── Task 10: Create modern CSS design system
├── Task 11: Rebuild dashboard layout with responsive design
├── Task 12: Add navigation improvements
├── Task 13: Update all UI components
└── Task 14: Add UI tests

Wave FINAL (Verification):
├── Task F1: Plan compliance audit
├── Task F2: Code quality review
├── Task F3: Real manual QA
└── Task F4: Scope fidelity check
```

### Dependency Matrix
- Tasks 1-4: Can run in parallel (Wave 1)
- Tasks 5-9: Can run in parallel (Wave 2, after Task 1)
- Tasks 10-14: Can run in parallel (Wave 3, depends on Tasks 5-8)
- Tasks F1-F4: Sequential final verification

---

## TODOs

- [ ] 1. Fix Auth System with Error Logging

  **What to do**:
  - Add detailed auth error logging to server.js
  - Fix auth flow to properly handle login failures
  - Add auth status endpoint with more info
  - Add session/token validation

  **Must NOT do**:
  - Don't change the password storage mechanism
  - Don't break existing auth endpoints

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
    - No special skills needed - standard Node.js debugging

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 5-14
  - **Blocked By**: None

  **References**:
  - `src/server.js:116-130` - Current auth implementation
  - `src/server.js:500-530` - Auth API endpoints
  - `tests/api.test.js` - Test patterns to follow

  **Acceptance Criteria**:
  - [ ] Auth errors are logged with proper messages
  - [ ] Login endpoint returns clear error on failure
  - [ ] /api/auth/check returns more detailed status

  **QA Scenarios**:
  ```
  Scenario: Successful login with valid password
    Tool: Bash (curl)
    Preconditions: DASHBOARD_PASSWORD set to "test123"
    Steps:
      1. curl -X POST http://localhost:7070/api/auth/login -H "Content-Type: application/json" -d '{"password":"test123"}'
    Expected Result: {"success":true,"token":"test123"}
    Evidence: .sisyphus/evidence/task-1-login-success.json

  Scenario: Failed login with wrong password
    Tool: Bash (curl)
    Preconditions: DASHBOARD_PASSWORD set to "test123"
    Steps:
      1. curl -X POST http://localhost:7070/api/auth/login -H "Content-Type: application/json" -d '{"password":"wrong"}'
    Expected Result: {"success":false,"error":"Invalid password"} (status 401)
    Evidence: .sisyphus/evidence/task-1-login-fail.json
  ```

  **Commit**: YES
  - Message: `fix(auth): add proper error handling and logging`
  - Files: `src/server.js`

---

- [ ] 2. Create pm2 ecosystem.config.js

  **What to do**:
  - Create ecosystem.config.js with pm2 configuration
  - Configure restart policies (restart delay, max restarts, exp backoff)
  - Set up proper environment variables
  - Configure logging (log file, max size, retain)
  - Add max memory limit and node instances

  **Must NOT do**:
  - Don't remove systemd files if they exist
  - Don't change the server startup port

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
    - pm2 configuration is standard Node.js DevOps

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:
  - PM2 official docs: https://pm2.keymetrics.io/docs/usage/application-declaration/
  - `package.json` - Current scripts and dependencies

  **Acceptance Criteria**:
  - [ ] ecosystem.config.js created with proper structure
  - [ ] Restart policy: restart delay 1000ms, max restarts 10, exp backoff
  - [ ] Log configuration: log file, max size 10MB, retain 10 files
  - [ ] Memory limit: 512MB
  - [ ] Instances: 1 (cluster mode not needed for this app)

  **QA Scenarios**:
  ```
  Scenario: pm2 ecosystem config is valid
    Tool: Bash
    Preconditions: pm2 installed
    Steps:
      1. cd /home/openclaw/.cloudflare-router && pm2 validate ecosystem.config.js 2>&1 || echo "VALID"
    Expected Result: Config is valid JSON/module
    Evidence: .sisyphus/evidence/task-2-pm2-validate.txt
  ```

  **Commit**: YES
  - Message: `feat(pm2): add ecosystem.config.js with restart policies`
  - Files: `ecosystem.config.js`

---

- [ ] 3. Add pm2 startup/shutdown scripts

  **What to do**:
  - Create startup script to generate pm2 startup command
  - Create save script to persist process list
  - Add pm2 commands to package.json scripts
  - Document the startup commands

  **Must NOT do**:
  - Don't modify systemd service files

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: None
  - **Blocked By**: Task 2

  **References**:
  - PM2 startup docs: https://pm2.keymetrics.io/docs/usage/startup/

  **Acceptance Criteria**:
  - [ ] package.json updated with pm2 scripts
  - [ ] Scripts for: start, stop, restart, reload, logs, monit

  **Commit**: YES
  - Message: `feat(pm2): add startup/shutdown scripts to package.json`
  - Files: `package.json`

---

- [ ] 4. Create systemd to pm2 migration guide

  **What to do**:
  - Document steps to stop systemd service
  - Document pm2 startup command generation
  - Create migration script (optional)
  - Document rollback steps

  **Must NOT do**:
  - Don't modify existing systemd files
  - Don't stop running services

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: None
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] Migration guide created in docs/

  **Commit**: YES
  - Message: `docs: add systemd to pm2 migration guide`
  - Files: `docs/MIGRATION.md`

---

- [ ] 5. Add Error Page Storage API

  **What to do**:
  - Create error pages storage directory structure
  - Add default error pages (404, 500, 502, 503)
  - Create error page loading/saving functions
  - Add error page validation

  **Must NOT do**:
  - Don't delete existing static error pages

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 6
  - **Blocked By**: Task 1

  **References**:
  - `src/errors/` - Existing error pages

  **Acceptance Criteria**:
  - [ ] Error pages stored in ~/.cloudflare-router/error-pages/
  - [ ] Default pages: 404.html, 500.html, 502.html, 503.html
  - [ ] JSON metadata file for each page

  **Commit**: YES
  - Message: `feat(error-pages): add error page storage system`
  - Files: `src/error-pages.js` (new)

---

- [ ] 6. Create Error Page GET/PUT Endpoints

  **What to do**:
  - Add GET /api/error-pages - list all error pages
  - Add GET /api/error-pages/:code - get specific error page
  - Add PUT /api/error-pages/:code - update error page content
  - Add validation for HTML content
  - Add error page serve middleware

  **Must NOT do**:
  - Don't break existing API endpoints

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 7-8
  - **Blocked By**: Task 5

  **References**:
  - `src/server.js` - Express app pattern
  - `src/config.js` - Config patterns

  **Acceptance Criteria**:
  - [ ] GET /api/error-pages returns list with metadata
  - [ ] GET /api/error-pages/404 returns page content
  - [ ] PUT /api/error-pages/404 updates content
  - [ ] Validation rejects invalid HTML gracefully

  **QA Scenarios**:
  ```
  Scenario: Get all error pages
    Tool: Bash (curl)
    Preconditions: Server running with auth token
    Steps:
      1. curl -s http://localhost:7070/api/error-pages -H "Authorization: Bearer test123"
    Expected Result: JSON array of error pages with code, name, content
    Evidence: .sisyphus/evidence/task-6-get-all.json

  Scenario: Update error page content
    Tool: Bash (curl)
    Preconditions: Server running
    Steps:
      1. curl -X PUT http://localhost:7070/api/error-pages/404 -H "Authorization: Bearer test123" -H "Content-Type: application/json" -d '{"content":"<html><body>Custom 404</body></html>"}'
    Expected Result: {"success":true}
    Evidence: .sisyphus/evidence/task-6-update.json
  ```

  **Commit**: YES
  - Message: `feat(api): add error page CRUD endpoints`
  - Files: `src/server.js`

---

- [ ] 7. Add WYSIWYG Editor Component

  **What to do**:
  - Integrate a lightweight WYSIWYG editor (e.g., TinyMCE or Quill)
  - Create editor component for HTML editing
  - Add preview functionality
  - Add template selection (blank, branded, minimal)

  **Must NOT do**:
  - Don't use external CDNs that might be blocked

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Task 6

  **References**:
  - `src/dashboard/index.html` - Current dashboard structure
  - Quill.js CDN or similar for WYSIWYG

  **Acceptance Criteria**:
  - [ ] WYSIWYG editor loads in error page settings
  - [ ] Can edit HTML content visually
  - [ ] Preview button shows rendered result
  - [ ] Template selector works

  **Commit**: YES
  - Message: `feat(ui): add WYSIWYG editor component`
  - Files: `src/dashboard/index.html`

---

- [ ] 8. Integrate Editor into Settings Tab

  **What to do**:
  - Add error page management section in Settings
  - List all error pages with edit buttons
  - Add "Add Custom Error Page" functionality
  - Add preview modal

  **Must NOT do**:
  - Don't change existing settings structure

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: Task 7

  **Acceptance Criteria**:
  - [ ] Settings tab shows error page management
  - [ ] Each error page has Edit button
  - [ ] Editor opens in modal
  - [ ] Save persists to storage

  **Commit**: YES
  - Message: `feat(dashboard): integrate error page editor in settings`
  - Files: `src/dashboard/index.html`

---

- [ ] 9. Add Error Page Tests

  **What to do**:
  - Add unit tests for error page storage functions
  - Add API tests for error page endpoints
  - Test validation edge cases
  - Test default page generation

  **Must NOT do**:
  - Don't modify existing test files

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: Task 6

  **References**:
  - `tests/api.test.js` - Test patterns
  - `tests/config.test.js` - Test patterns

  **Acceptance Criteria**:
  - [ ] Tests for error-page.js functions
  - [ ] API tests for GET/PUT endpoints
  - [ ] All tests pass

  **Commit**: YES
  - Message: `test(error-pages): add tests for error page functionality`
  - Files: `tests/error-pages.test.js` (new)

---

- [ ] 10. Create Modern CSS Design System

  **What to do**:
  - Create comprehensive CSS variables for theming
  - Define color palette (primary, secondary, accent, success, warning, error)
  - Define typography system (font families, sizes, weights)
  - Define spacing and layout tokens
  - Add dark/light theme support
  - Create component classes (buttons, cards, inputs, modals, tables)

  **Must NOT do**:
  - Don't break existing inline styles completely
  - Keep backward compatibility where possible

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 11-13
  - **Blocked By**: Tasks 5-8

  **References**:
  - `src/dashboard/index.html` - Current inline styles
  - Modern design systems (Tailwind-inspired but custom)

  **Acceptance Criteria**:
  - [ ] CSS variables for colors, fonts, spacing
  - [ ] Theme toggle works
  - [ ] Component classes defined
  - [ ] Responsive breakpoints defined

  **Commit**: YES
  - Message: `feat(ui): add modern CSS design system`
  - Files: `src/dashboard/styles.css` (new)

---

- [ ] 11. Rebuild Dashboard Layout with Responsive Design

  **What to do**:
  - Create responsive grid layout
  - Add mobile navigation (hamburger menu)
  - Make cards and tables responsive
  - Add touch-friendly interactions
  - Implement sidebar navigation with icons

  **Must NOT do**:
  - Don't remove existing functionality
  - Keep all tabs working

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: Task 10

  **Acceptance Criteria**:
  - [ ] Layout works on mobile (320px+)
  - [ ] Layout works on tablet (768px+)
  - [ ] Layout works on desktop (1024px+)
  - [ ] Navigation collapses on mobile

  **QA Scenarios**:
  ```
  Scenario: Dashboard loads on mobile viewport
    Tool: Playwright
    Preconditions: Server running, logged in
    Steps:
      1. Set viewport to 375x667 (iPhone SE)
      2. Navigate to http://localhost:7070
      3. Take screenshot
    Expected Result: Dashboard is usable, navigation accessible
    Evidence: .sisyphus/evidence/task-11-mobile.png
  ```

  **Commit**: YES
  - Message: `feat(ui): add responsive dashboard layout`
  - Files: `src/dashboard/index.html`

---

- [ ] 12. Add Navigation Improvements

  **What to do**:
  - Create icon-based sidebar navigation
  - Add breadcrumb navigation
  - Add quick actions toolbar
  - Improve tab organization (group related features)
  - Add keyboard shortcuts

  **Must NOT do**:
  - Don't change URL structure

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: Task 10

  **Acceptance Criteria**:
  - [ ] Sidebar with icons and labels
  - [ ] Active tab clearly indicated
  - [ ] Quick actions visible on main pages

  **Commit**: YES
  - Message: `feat(ui): improve navigation with icons and quick actions`
  - Files: `src/dashboard/index.html`

---

- [ ] 13. Update All UI Components

  **What to do**:
  - Style all form inputs consistently
  - Style all buttons (primary, secondary, danger, ghost)
  - Style tables with better spacing and hover states
  - Style cards with shadows and borders
  - Style modals with better animations
  - Style toasts with icons
  - Style loading states

  **Must NOT do**:
  - Don't change component functionality

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: Task 10

  **Acceptance Criteria**:
  - [ ] All inputs styled consistently
  - [ ] All buttons have proper hover/active states
  - [ ] Tables have hover highlighting
  - [ ] Modals have smooth animations

  **Commit**: YES
  - Message: `feat(ui): style all UI components`
  - Files: `src/dashboard/styles.css`

---

- [ ] 14. Add UI Tests

  **What to do**:
  - Add Playwright tests for dashboard loading
  - Add tests for login flow
  - Add tests for navigation
  - Add tests for responsive behavior

  **Must NOT do**:
  - Don't modify existing test files

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: Tasks 11-13

  **Acceptance Criteria**:
  - [ ] Dashboard loads without errors
  - [ ] Login flow works
  - [ ] Navigation works
  - [ ] Tests pass

  **Commit**: YES
  - Message: `test(ui): add dashboard UI tests`
  - Files: `tests/ui.test.js` (new)

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  - Verify all "Must Have" items are implemented
  - Verify all "Must NOT Have" items are avoided
  - Verify all tasks have evidence files

- [ ] F2. **Code Quality Review** — `unspecified-high`
  - Run `npm test` - all tests pass
  - Check for console.log in production code
  - Verify no TypeScript/eslint errors

- [ ] F3. **Real Manual QA** — `unspecified-high`
  - Test login flow manually
  - Test pm2 startup
  - Test error page editing
  - Test UI on different screen sizes

- [ ] F4. **Scope Fidelity Check** — `deep`
  - Verify no functionality was broken
  - Verify all requested features are present
  - Verify no unauthorized changes

---

## Commit Strategy

- **Wave 1**: 4 commits (auth fix, pm2 config, scripts, docs)
- **Wave 2**: 5 commits (error pages, API, editor, integration, tests)
- **Wave 3**: 5 commits (design system, layout, nav, components, tests)
- **Final**: 1 commit (version bump if needed)

---

## Success Criteria

### Verification Commands
```bash
npm test  # All tests pass
pm2 validate  # Config is valid
curl http://localhost:7070/api/error-pages  # Returns error pages
```

### Final Checklist
- [ ] Auth errors are logged and displayed properly
- [ ] pm2 ecosystem.config.js created with proper restart policies
- [ ] Service survives reboot via pm2 startup
- [ ] Error pages editable via WYSIWYG editor
- [ ] UI is modern, responsive, and user-friendly
- [ ] All tests pass
- [ ] No existing functionality broken
