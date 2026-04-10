'use strict';

/**
 * Token auth TTL and max-size eviction tests
 *
 * Tests the TTL expiry logic and max-size eviction logic inline,
 * mirroring the actual implementation in src/server.js authMiddleware.
 *
 * Inline approach (like security.test.js) avoids module-reload complexity
 * and tests the logic directly with known state.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_TOKENS = 100;

// ── Inline auth logic (mirrors src/server.js) ────────────────────────────────

function isExpired(tokenData) {
  return Date.now() - tokenData.created > TOKEN_TTL_MS;
}

/**
 * Simulate authMiddleware token validation (password-protected mode).
 * Returns 'next' | 'expired' | 'unauthorized'
 */
function checkToken(AUTH_TOKENS, token) {
  const tokenData = AUTH_TOKENS.get(token);
  if (!tokenData) return 'unauthorized';
  if (isExpired(tokenData)) {
    AUTH_TOKENS.delete(token);
    return 'expired';
  }
  return 'next';
}

/**
 * Simulate login eviction: if map >= MAX_TOKENS, evict oldest before inserting.
 */
function loginWithEviction(AUTH_TOKENS, newToken) {
  if (AUTH_TOKENS.size >= MAX_TOKENS) {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [k, v] of AUTH_TOKENS) {
      if (v.created < oldestTime) { oldestTime = v.created; oldestKey = k; }
    }
    if (oldestKey) AUTH_TOKENS.delete(oldestKey);
  }
  AUTH_TOKENS.set(newToken, { created: Date.now() });
}

// ── TTL Expiry Tests ──────────────────────────────────────────────────────────

describe('Token auth — TTL expiry logic', () => {
  let AUTH_TOKENS;

  beforeEach(() => {
    AUTH_TOKENS = new Map();
  });

  test('1. fresh token (just created) is accepted', () => {
    AUTH_TOKENS.set('fresh', { created: Date.now() });
    expect(checkToken(AUTH_TOKENS, 'fresh')).toBe('next');
  });

  test('2. token created 23h59m ago is accepted (just under TTL)', () => {
    const almostExpired = Date.now() - (23 * 60 * 60 * 1000 + 59 * 60 * 1000);
    AUTH_TOKENS.set('almost', { created: almostExpired });
    expect(checkToken(AUTH_TOKENS, 'almost')).toBe('next');
  });

  test('3. token 1ms past 24h boundary is expired (boundary check uses strict >)', () => {
    AUTH_TOKENS.set('boundary', { created: Date.now() - TOKEN_TTL_MS - 1 });
    expect(checkToken(AUTH_TOKENS, 'boundary')).toBe('expired');
  });

  test('4. token created 25h ago is rejected as expired', () => {
    AUTH_TOKENS.set('old', { created: Date.now() - (25 * 60 * 60 * 1000) });
    expect(checkToken(AUTH_TOKENS, 'old')).toBe('expired');
  });

  test('5. expired token is deleted from map after check', () => {
    AUTH_TOKENS.set('stale', { created: Date.now() - (25 * 60 * 60 * 1000) });
    checkToken(AUTH_TOKENS, 'stale');
    expect(AUTH_TOKENS.has('stale')).toBe(false);
  });

  test('6. unknown token returns unauthorized', () => {
    expect(checkToken(AUTH_TOKENS, 'nonexistent')).toBe('unauthorized');
  });

  test('7. TOKEN_TTL_MS constant is 24 hours', () => {
    expect(TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

// ── Max-size Eviction Tests ───────────────────────────────────────────────────

describe('Token auth — max-size eviction', () => {
  let AUTH_TOKENS;

  beforeEach(() => {
    AUTH_TOKENS = new Map();
  });

  test('8. MAX_TOKENS cap is 100', () => {
    expect(MAX_TOKENS).toBe(100);
  });

  test('9. map stays at or below 100 after login at cap', () => {
    for (let i = 0; i < 100; i++) {
      AUTH_TOKENS.set(`t-${i}`, { created: Date.now() - i });
    }
    loginWithEviction(AUTH_TOKENS, 'new-token');
    expect(AUTH_TOKENS.size).toBeLessThanOrEqual(100);
  });

  test('10. oldest token is evicted when map is at cap', () => {
    const oldestToken = 'oldest-sentinel';
    AUTH_TOKENS.set(oldestToken, { created: Date.now() - 999999 }); // oldest
    for (let i = 1; i < 100; i++) {
      AUTH_TOKENS.set(`t-${i}`, { created: Date.now() - i });
    }
    expect(AUTH_TOKENS.size).toBe(100);

    loginWithEviction(AUTH_TOKENS, 'new-entry');
    expect(AUTH_TOKENS.has(oldestToken)).toBe(false);
  });

  test('11. new token is present in map after login', () => {
    for (let i = 0; i < 100; i++) {
      AUTH_TOKENS.set(`t-${i}`, { created: Date.now() - i });
    }
    loginWithEviction(AUTH_TOKENS, 'fresh-login');
    expect(AUTH_TOKENS.has('fresh-login')).toBe(true);
  });

  test('12. below cap: no eviction occurs on login', () => {
    AUTH_TOKENS.set('keep-me', { created: Date.now() - 50000 });
    loginWithEviction(AUTH_TOKENS, 'newcomer');
    // Map had 1 entry before login — no eviction should happen
    expect(AUTH_TOKENS.has('keep-me')).toBe(true);
    expect(AUTH_TOKENS.size).toBe(2);
  });
});
