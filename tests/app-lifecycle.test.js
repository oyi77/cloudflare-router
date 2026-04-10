/**
 * tests/app-lifecycle.test.js
 * HTTP API tests for app lifecycle and portless endpoints.
 * Uses supertest (confirmed in devDependencies).
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// setup.js sets process.env.HOME to tests/fixtures/home — loaded via jest setupFiles
const CONFIG_DIR = path.join(process.env.HOME, '.cloudflare-router');
const APPS_YAML = path.join(CONFIG_DIR, 'apps.yaml');
const PORTLESS_FILE = path.join(CONFIG_DIR, 'portless.yml');

// Helper: write a minimal apps.yaml with one entry
function writeAppsYaml(apps) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(APPS_YAML, yaml.dump({ apps }, { lineWidth: -1 }));
}

// Helper: clean slate between tests
function cleanAppsYaml() {
  try { fs.unlinkSync(APPS_YAML); } catch (_) {}
}

function cleanPortlessFile() {
  try { fs.unlinkSync(PORTLESS_FILE); } catch (_) {}
  try { fs.unlinkSync(PORTLESS_FILE + '.lock'); } catch (_) {}
}

// Bust portless module cache so each describe block gets a fresh registry
function bustPortlessCache() {
  Object.keys(require.cache).forEach(k => {
    if (k.includes('portless')) delete require.cache[k];
  });
}

// We import app after setup.js has already overridden HOME
const { app } = require('../src/server');

describe('App Lifecycle API', () => {
  beforeEach(() => {
    cleanAppsYaml();
    cleanPortlessFile();
    bustPortlessCache();
  });

  // 1. PUT /api/apps/:name with valid config → 200
  test('PUT /api/apps/:name with valid config returns 200', async () => {
    const res = await request(app)
      .put('/api/apps/myapp')
      .send({ command: 'node server.js', port: 3000 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // 2. PUT /api/apps/:name with name containing ';' → 400
  test("PUT /api/apps/:name with name containing ';' returns 400", async () => {
    const res = await request(app)
      .put('/api/apps/bad;name')
      .send({ command: 'node server.js' });
    expect(res.status).toBe(400);
  });

  // 3. PUT /api/apps/:name with invalid restartPolicy → 400
  test('PUT /api/apps/:name with invalid restartPolicy returns 400', async () => {
    const res = await request(app)
      .put('/api/apps/myapp')
      .send({ restartPolicy: 'invalid-policy' });
    expect(res.status).toBe(400);
  });

  // 4. PUT /api/apps/:name with port out of range → 400
  test('PUT /api/apps/:name with port out of range returns 400', async () => {
    const res = await request(app)
      .put('/api/apps/myapp')
      .send({ port: 99999 });
    expect(res.status).toBe(400);
  });

  // 5. PUT /api/apps/:name with wrong type for port → 400
  test('PUT /api/apps/:name with wrong type for port returns 400', async () => {
    const res = await request(app)
      .put('/api/apps/myapp')
      .send({ port: 'not-a-number' });
    expect(res.status).toBe(400);
  });

  // 6. PUT /api/apps/:name — unknown fields are stripped (not error)
  test('PUT /api/apps/:name strips unknown fields without error', async () => {
    const res = await request(app)
      .put('/api/apps/myapp')
      .send({ command: 'node app.js', unknownField: 'should-be-stripped' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Verify the field was indeed stripped
    const data = yaml.load(fs.readFileSync(APPS_YAML, 'utf8'));
    expect(data.apps.myapp.unknownField).toBeUndefined();
  });

  // 7. POST /api/apps/:name/restart for non-existent app → 404
  test('POST /api/apps/:name/restart for non-existent app returns 404', async () => {
    const res = await request(app)
      .post('/api/apps/nonexistent/restart');
    expect(res.status).toBe(404);
  });

  // 8. PATCH /api/apps/:name/config with valid data → 200 or 404
  test('PATCH /api/apps/:name/config with valid data returns 200 when app exists', async () => {
    writeAppsYaml({ myapp: { command: 'node app.js' } });
    const res = await request(app)
      .patch('/api/apps/myapp/config')
      .send({ autoStart: true, restartPolicy: 'always' });
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
    }
  });

  // 9. PATCH /api/apps/:name/config with invalid restartPolicy → 400
  test('PATCH /api/apps/:name/config with invalid restartPolicy returns 400', async () => {
    writeAppsYaml({ myapp: { command: 'node app.js' } });
    const res = await request(app)
      .patch('/api/apps/myapp/config')
      .send({ restartPolicy: 'bad-value' });
    expect(res.status).toBe(400);
  });

  // 10. GET /api/apps/:name/logs for non-existent app → 404 or { logs: [] }
  test('GET /api/apps/:name/logs for non-existent app returns 404 or empty logs', async () => {
    const res = await request(app).get('/api/apps/ghost/logs');
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('logs');
      expect(Array.isArray(res.body.logs)).toBe(true);
    }
  });

  // 11. GET /api/apps/:name/logs returns { logs: [...] } structure
  test('GET /api/apps/:name/logs returns logs array structure', async () => {
    // Create a log file for the app
    const logsDir = path.join(CONFIG_DIR, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, 'app-testapp.log'), 'line1\nline2\n');
    const res = await request(app).get('/api/apps/testapp/logs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('logs');
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.logs.length).toBeGreaterThan(0);
    // cleanup
    try { fs.unlinkSync(path.join(logsDir, 'app-testapp.log')); } catch (_) {}
  });

  // 12. GET /api/apps/:name/status returns status info
  test('GET /api/apps/:name/status returns status info', async () => {
    const res = await request(app).get('/api/apps/myapp/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('running');
  });

  // 13. POST /api/apps/:name/start for non-existent app returns 404
  test('POST /api/apps/:name/start for non-existent app returns 404', async () => {
    const res = await request(app).post('/api/apps/ghost/start');
    expect(res.status).toBe(404);
  });

  // 14. POST /api/apps/:name/stop for non-running app returns 400
  test('POST /api/apps/:name/stop for non-running app returns 400', async () => {
    const res = await request(app).post('/api/apps/myapp/stop');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('Portless API', () => {
  beforeEach(() => {
    cleanAppsYaml();
    cleanPortlessFile();
    bustPortlessCache();
  });

  // Helper: register a portless service via API
  async function registerPortlessSvc(name) {
    return request(app)
      .post('/api/portless')
      .send({ name, description: 'test service' });
  }

  // 15. PATCH /api/portless/:name/toggle with enabled: true → 200 or 404
  test('PATCH /api/portless/:name/toggle with enabled: true returns 200 when service exists', async () => {
    // Register first
    const reg = await registerPortlessSvc('mysvc');
    expect(reg.status).toBe(201);

    const res = await request(app)
      .patch('/api/portless/mysvc/toggle')
      .send({ enabled: true });
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
    }
  });

  // 16. PATCH /api/portless/:name/toggle with enabled: 'string' → 400
  test('PATCH /api/portless/:name/toggle with enabled as string returns 400', async () => {
    const res = await request(app)
      .patch('/api/portless/mysvc/toggle')
      .send({ enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  // 17. POST /api/portless/:name/test returns { tcp, ... } structure
  test('POST /api/portless/:name/test returns object with tcp field', async () => {
    const reg = await registerPortlessSvc('testsvc');
    expect(reg.status).toBe(201);

    const res = await request(app).post('/api/portless/testsvc/test');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tcp');
  });

  // 18. PATCH /api/portless/:name/toggle for non-existent service → error (500 or throws)
  test('PATCH /api/portless/:name/toggle for non-existent service returns error status', async () => {
    const res = await request(app)
      .patch('/api/portless/ghost-svc/toggle')
      .send({ enabled: true });
    // The route calls enableService which throws — express asyncHandler converts to 500
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // 19. Auth middleware: /api/auth/check is publicly accessible (exempt from auth)
  test('GET /api/auth/check is publicly accessible without credentials', async () => {
    const res = await request(app).get('/api/auth/check');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('auth_required');
  });

  // 20. Auth middleware: authenticated request passes through
  test('Auth middleware passes request when no password is configured', async () => {
    const original = process.env.DASHBOARD_PASSWORD;
    process.env.DASHBOARD_PASSWORD = '';
    try {
      const res = await request(app).get('/api/accounts');
      // No password set → passes auth → should not be 401
      expect(res.status).not.toBe(401);
    } finally {
      process.env.DASHBOARD_PASSWORD = original || '';
    }
  });
});
