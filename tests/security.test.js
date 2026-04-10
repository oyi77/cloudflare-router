'use strict';

const crypto = require('crypto');

// Inline validation logic (mirrors src/mcp.js and src/server.js)
function validateAppName(name) {
  if (!name || typeof name !== 'string') throw new Error('App name is required');
  if (name.length > 128) throw new Error('App name too long (max 128 chars)');
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('App name must contain only letters, numbers, hyphens, and underscores');
}

function sanitizeAppConfig(body) {
  const ALLOWED = {
    command: 'string', script: 'string', cwd: 'string', mode: 'string',
    port: 'number', restartPolicy: 'string', enabled: 'boolean', autoStart: 'boolean'
  };
  const VALID_POLICIES = ['always', 'on-failure', 'never'];
  const result = {};
  for (const [key, type] of Object.entries(ALLOWED)) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== type) throw new Error(`${key} must be ${type}`);
    if (key === 'restartPolicy' && !VALID_POLICIES.includes(body[key]))
      throw new Error('restartPolicy must be always, on-failure, or never');
    if (key === 'port' && (body[key] < 1 || body[key] > 65535))
      throw new Error('port must be 1-65535');
    result[key] = body[key];
  }
  if (body.env && typeof body.env === 'object' && !Array.isArray(body.env)) {
    for (const v of Object.values(body.env)) {
      if (typeof v !== 'string') throw new Error('env values must be strings');
    }
    result.env = body.env;
  }
  return result;
}

const DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const CONFIG_BASENAME_RE = /^[a-zA-Z0-9_.-]+\.yml$/;

// ──────────────────────────────────────────────
// Group 1 — validateAppName
// ──────────────────────────────────────────────
describe('validateAppName', () => {
  test('accepts valid name with hyphens and underscores', () => {
    expect(() => validateAppName('my-app_1')).not.toThrow();
  });

  test('rejects name with semicolon', () => {
    expect(() => validateAppName('my;app')).toThrow();
  });

  test('rejects name exceeding 128 chars', () => {
    expect(() => validateAppName('a'.repeat(129))).toThrow('App name too long (max 128 chars)');
  });

  test('rejects empty string', () => {
    expect(() => validateAppName('')).toThrow('App name is required');
  });

  test('rejects name with pipe character', () => {
    expect(() => validateAppName('my|app')).toThrow();
  });

  test('rejects name with dollar sign', () => {
    expect(() => validateAppName('my$app')).toThrow();
  });

  test('rejects name with backtick', () => {
    expect(() => validateAppName('my`app')).toThrow();
  });

  test('accepts name exactly 128 chars long', () => {
    expect(() => validateAppName('a'.repeat(128))).not.toThrow();
  });
});

// ──────────────────────────────────────────────
// Group 2 — sanitizeAppConfig
// ──────────────────────────────────────────────
describe('sanitizeAppConfig', () => {
  test('returns allowed fields from valid config', () => {
    const result = sanitizeAppConfig({ command: 'node app.js', autoStart: true, restartPolicy: 'always' });
    expect(result).toEqual({ command: 'node app.js', autoStart: true, restartPolicy: 'always' });
  });

  test('strips unknown fields without throwing', () => {
    const result = sanitizeAppConfig({ hacked: 'malicious' });
    expect(result).toEqual({});
  });

  test('throws when port is not a number', () => {
    expect(() => sanitizeAppConfig({ port: 'not-a-number' })).toThrow('port must be number');
  });

  test('throws for invalid restartPolicy value', () => {
    expect(() => sanitizeAppConfig({ restartPolicy: 'invalid' })).toThrow('restartPolicy must be always, on-failure, or never');
  });

  test('throws when port exceeds 65535', () => {
    expect(() => sanitizeAppConfig({ port: 99999 })).toThrow('port must be 1-65535');
  });

  test('throws when port is 0', () => {
    expect(() => sanitizeAppConfig({ port: 0 })).toThrow('port must be 1-65535');
  });

  test('throws when env values are not strings', () => {
    expect(() => sanitizeAppConfig({ env: { KEY: 123 } })).toThrow('env values must be strings');
  });

  test('preserves valid env in result', () => {
    const result = sanitizeAppConfig({ env: { KEY: 'value' } });
    expect(result.env).toEqual({ KEY: 'value' });
  });
});

// ──────────────────────────────────────────────
// Group 3 — Domain validation regex
// ──────────────────────────────────────────────
describe('Domain validation regex', () => {
  test('matches example.com', () => {
    expect(DOMAIN_RE.test('example.com')).toBe(true);
  });

  test('matches sub.example.com', () => {
    expect(DOMAIN_RE.test('sub.example.com')).toBe(true);
  });

  test('matches my-site.co.uk', () => {
    expect(DOMAIN_RE.test('my-site.co.uk')).toBe(true);
  });

  test('does not match path traversal ../../etc/passwd', () => {
    expect(DOMAIN_RE.test('../../etc/passwd')).toBe(false);
  });

  test('does not match shell injection ; rm -rf /', () => {
    expect(DOMAIN_RE.test('; rm -rf /')).toBe(false);
  });

  test('does not match empty string', () => {
    expect(DOMAIN_RE.test('')).toBe(false);
  });

  test('does not match localhost (no dot)', () => {
    expect(DOMAIN_RE.test('localhost')).toBe(false);
  });
});

// ──────────────────────────────────────────────
// Group 4 — configPath basename validation regex
// ──────────────────────────────────────────────
describe('Config basename validation regex', () => {
  test('matches config.yml', () => {
    expect(CONFIG_BASENAME_RE.test('config.yml')).toBe(true);
  });

  test('matches my-tunnel.yml', () => {
    expect(CONFIG_BASENAME_RE.test('my-tunnel.yml')).toBe(true);
  });

  test('does not match path traversal basename ../../../etc/evil.sh', () => {
    // basename of path traversal contains slashes — test the segment after last slash
    expect(CONFIG_BASENAME_RE.test('../../../etc/evil.sh')).toBe(false);
  });

  test('does not match config.yml with shell injection suffix', () => {
    expect(CONFIG_BASENAME_RE.test('config.yml; rm -rf /')).toBe(false);
  });

  test('does not match config.yml.sh (wrong extension)', () => {
    expect(CONFIG_BASENAME_RE.test('config.yml.sh')).toBe(false);
  });

  test('does not match filename with embedded newline', () => {
    expect(CONFIG_BASENAME_RE.test('evil\ncommand.yml')).toBe(false);
  });
});

// ──────────────────────────────────────────────
// Group 5 — Auth token format
// ──────────────────────────────────────────────
describe('Auth token format', () => {
  test('randomBytes(32).hex produces a 64-char lowercase hex string', () => {
    const token = crypto.randomBytes(32).toString('hex');
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(token.length).toBe(64);
  });

  test('two generated tokens are distinct (randomness check)', () => {
    const t1 = crypto.randomBytes(32).toString('hex');
    const t2 = crypto.randomBytes(32).toString('hex');
    expect(t1).not.toBe(t2);
  });
});
