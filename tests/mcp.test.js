/**
 * MCP tool handler tests
 * Tests validateAppName and handleToolCall from src/mcp.js
 */

const { TOOLS, handleToolCall } = require('../src/mcp');

// ── validateAppName tests ─────────────────────────────────────────────────────
// We exercise the function indirectly via the exported handleToolCall switch
// which calls validateAppName internally, BUT the function is also accessible
// through the module internals. Since validateAppName is not exported we
// replicate the same logic here to unit-test the rules directly, then verify
// the tool handler enforces them end-to-end.

function validateAppName(name) {
  if (!name || typeof name !== 'string') throw new Error('App name is required');
  if (name.length > 128) throw new Error('App name too long (max 128 chars)');
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('App name must contain only letters, numbers, hyphens, and underscores');
}

describe('validateAppName (inline mirror)', () => {
  test('1. valid simple name passes', () => {
    expect(() => validateAppName('my-app')).not.toThrow();
  });

  test('2. semicolon in name throws', () => {
    expect(() => validateAppName('my;app')).toThrow();
  });

  test('3. pipe in name throws', () => {
    expect(() => validateAppName('my|app')).toThrow();
  });

  test('4. name > 128 chars throws', () => {
    expect(() => validateAppName('a'.repeat(129))).toThrow();
  });

  test('5. empty string throws', () => {
    expect(() => validateAppName('')).toThrow();
  });

  test('6. null throws', () => {
    expect(() => validateAppName(null)).toThrow();
  });

  test('7. number (non-string) throws', () => {
    expect(() => validateAppName(123)).toThrow();
  });

  test('8. name exactly 128 chars passes', () => {
    expect(() => validateAppName('a'.repeat(128))).not.toThrow();
  });

  test('9. underscores, hyphens, digits pass', () => {
    expect(() => validateAppName('hello_world-123')).not.toThrow();
  });
});

// ── TOOLS array tests ─────────────────────────────────────────────────────────

describe('TOOLS array', () => {
  test('10. TOOLS is an array', () => {
    expect(Array.isArray(TOOLS)).toBe(true);
  });

  test('11. total tool count >= 27', () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(27);
  });

  test('12. contains cf_router_app_stop', () => {
    expect(TOOLS.some(t => t.name === 'cf_router_app_stop')).toBe(true);
  });

  test('13. contains cf_router_portless_list', () => {
    expect(TOOLS.some(t => t.name === 'cf_router_portless_list')).toBe(true);
  });

  test('14. every tool has a name and description', () => {
    TOOLS.forEach(t => {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
    });
  });

  test('15. every tool has an inputSchema', () => {
    TOOLS.forEach(t => {
      expect(t.inputSchema).toBeDefined();
      expect(t.inputSchema.type).toBe('object');
    });
  });
});

// ── handleToolCall tests ──────────────────────────────────────────────────────

describe('handleToolCall', () => {
  test('16. unknown tool returns error', async () => {
    const result = await handleToolCall('nonexistent_tool_xyz', {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown tool/i);
  });

  test('17. cf_router_portless_list returns success with services array', async () => {
    const result = await handleToolCall('cf_router_portless_list', {});
    expect(result.success).toBe(true);
    expect(Array.isArray(result.services)).toBe(true);
  });

  test('18. cf_router_app_start with missing name returns error', async () => {
    const result = await handleToolCall('cf_router_app_start', {});
    expect(result.error).toBeDefined();
  });

  test('19. cf_router_app_stop with missing name returns error', async () => {
    const result = await handleToolCall('cf_router_app_stop', {});
    expect(result.error).toBeDefined();
  });

  test('20. cf_router_app_restart with missing name returns error', async () => {
    const result = await handleToolCall('cf_router_app_restart', {});
    expect(result.error).toBeDefined();
  });

  test('21. cf_router_app_status with missing name returns error', async () => {
    const result = await handleToolCall('cf_router_app_status', {});
    expect(result.error).toBeDefined();
  });

  test('22. cf_router_app_logs with missing name returns error', async () => {
    const result = await handleToolCall('cf_router_app_logs', {});
    expect(result.error).toBeDefined();
  });

  test('23. cf_router_app_config with missing name returns error', async () => {
    const result = await handleToolCall('cf_router_app_config', {});
    expect(result.error).toBeDefined();
  });

  test('24. cf_router_app_start with invalid name (semicolon) returns error', async () => {
    const result = await handleToolCall('cf_router_app_start', { name: 'bad;name' });
    expect(result.error).toBeDefined();
  });

  test('25. cf_router_app_stop with invalid name (pipe) returns error', async () => {
    const result = await handleToolCall('cf_router_app_stop', { name: 'bad|name' });
    expect(result.error).toBeDefined();
  });
});
