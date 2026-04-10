'use strict';

/**
 * Path-traversal prevention tests
 *
 * Tests that the API correctly rejects path traversal attempts in:
 * - PUT /api/nginx/configs/:file (nginx config write)
 * - POST /api/config/import (mapping filename traversal)
 * - POST /api/backup/restore (backup filename traversal)
 */

const request = require('supertest');

describe('Path traversal — PUT /api/nginx/configs/:file', () => {
  let app;

  beforeAll(() => {
    delete process.env.DASHBOARD_PASSWORD;
    ({ app } = require('../src/server'));
  });

  test('1. rejects filename with path traversal (..%2F)', async () => {
    const res = await request(app)
      .put('/api/nginx/configs/..%2F..%2Fetc%2Fcrontab')
      .send({ content: 'malicious' });
    expect(res.status).toBe(400);
  });

  test('2. rejects filename with encoded slash traversal', async () => {
    const res = await request(app)
      .put('/api/nginx/configs/%2Fetc%2Fpasswd')
      .send({ content: 'malicious' });
    expect(res.status).toBe(400);
  });

  test('3. rejects filename with dot-dot segment (404 or 400 = traversal blocked)', async () => {
    const res = await request(app)
      .put('/api/nginx/configs/../../../etc/hosts')
      .send({ content: 'malicious' });
    // Express URL normalization may resolve path before our handler (404),
    // or our handler catches it (400). Either way the write is blocked.
    expect([400, 404]).toContain(res.status);
  });

  test('4. accepts valid .conf filename', async () => {
    const res = await request(app)
      .put('/api/nginx/configs/valid-site.conf')
      .send({ content: 'server { listen 80; }' });
    // 404 (file not found) or 200 (written) — neither is 400
    expect(res.status).not.toBe(400);
  });

  test('5. rejects filename without .conf extension', async () => {
    const res = await request(app)
      .put('/api/nginx/configs/evil.sh')
      .send({ content: 'rm -rf /' });
    expect(res.status).toBe(400);
  });
});

describe('Path traversal — POST /api/config/import', () => {
  let app;

  beforeAll(() => {
    delete process.env.DASHBOARD_PASSWORD;
    ({ app } = require('../src/server'));
  });

  test('6. rejects mapping filename with ../ traversal', async () => {
    const res = await request(app)
      .post('/api/config/import')
      .send({ mappings: { '../evil.yml': 'content' } });
    expect(res.status).toBe(400);
  });

  test('7. rejects mapping filename with encoded path separator', async () => {
    const res = await request(app)
      .post('/api/config/import')
      .send({ mappings: { '..%2Fevil.yml': 'content' } });
    expect(res.status).toBe(400);
  });

  test('8. accepts valid .yml mapping filename', async () => {
    const res = await request(app)
      .post('/api/config/import')
      .send({ mappings: { 'valid-mapping.yml': 'subdomain: test\nport: 3000\n' } });
    // 200 success or 500 (dir not exist) — not 400
    expect([200, 500]).toContain(res.status);
  });

  test('9. rejects mapping filename with non-.yml extension', async () => {
    const res = await request(app)
      .post('/api/config/import')
      .send({ mappings: { 'evil.sh': 'content' } });
    expect(res.status).toBe(400);
  });
});

describe('Path traversal — POST /api/backup/restore', () => {
  let app;

  beforeAll(() => {
    delete process.env.DASHBOARD_PASSWORD;
    ({ app } = require('../src/server'));
  });

  test('10. rejects backup filename with ../ traversal', async () => {
    const res = await request(app)
      .post('/api/backup/restore')
      .send({ file: '../../../etc/passwd' });
    expect(res.status).toBe(400);
  });

  test('11. rejects backup filename with encoded traversal', async () => {
    const res = await request(app)
      .post('/api/backup/restore')
      .send({ file: '..%2F..%2Fetc%2Fshadow' });
    expect(res.status).toBe(400);
  });

  test('12. rejects backup filename with invalid chars', async () => {
    const res = await request(app)
      .post('/api/backup/restore')
      .send({ file: 'evil;rm -rf /.json' });
    expect(res.status).toBe(400);
  });

  test('13. rejects missing file field', async () => {
    const res = await request(app)
      .post('/api/backup/restore')
      .send({});
    expect(res.status).toBe(400);
  });

  test('14. accepts valid backup filename format', async () => {
    const res = await request(app)
      .post('/api/backup/restore')
      .send({ file: 'backup-2024-01-01.json' });
    // 400 (invalid filename) should NOT occur; 404/500 acceptable (file not found)
    expect(res.status).not.toBe(400);
  });
});
