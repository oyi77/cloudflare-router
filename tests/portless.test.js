/**
 * tests/portless.test.js
 * Unit tests for src/portless.js — portless service registry
 */

const path = require('path');
const fs = require('fs');

// setup.js sets process.env.HOME to tests/fixtures/home
// portless.js reads CONFIG_DIR from process.env.HOME at module load time,
// so we must clear require cache to pick up the new HOME between tests.

const PORTLESS_FILE = path.join(process.env.HOME, '.cloudflare-router', 'portless.yml');
const LOCK_FILE = PORTLESS_FILE + '.lock';

function freshPortless() {
  // Remove portless file so each test starts clean
  try { fs.unlinkSync(PORTLESS_FILE); } catch (_) {}
  try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
  // Bust require cache so module re-reads CONFIG_DIR / PORTLESS_FILE
  Object.keys(require.cache).forEach(k => {
    if (k.includes('portless')) delete require.cache[k];
  });
  return require('../src/portless');
}

describe('portless — service registry', () => {
  let portless;

  beforeEach(() => {
    portless = freshPortless();
  });

  // 1. registerService creates a service with enabled: true
  test('registerService creates a service with enabled: true', async () => {
    const port = await portless.registerService('svc-a');
    const svc = portless.listServices().find(s => s.name === 'svc-a');
    expect(svc).toBeDefined();
    expect(svc.enabled).toBe(true);
  });

  // 2. registerService returns the assigned port number
  test('registerService returns the allocated port number', async () => {
    const port = await portless.registerService('svc-b');
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThanOrEqual(portless.PORT_RANGE_START);
    expect(port).toBeLessThanOrEqual(portless.PORT_RANGE_END);
  });

  // 3. listServices returns all services, each with enabled field
  test('listServices returns all services each with enabled field', async () => {
    await portless.registerService('svc-c');
    await portless.registerService('svc-d');
    const services = portless.listServices();
    expect(services.length).toBe(2);
    services.forEach(s => {
      expect(s).toHaveProperty('enabled');
    });
  });

  // 4. getPort returns the port for a registered service
  test('getPort returns the port for a registered service', async () => {
    const port = await portless.registerService('svc-e');
    const retrieved = portless.getPort('svc-e');
    expect(retrieved).toBe(port);
  });

  // 5. enableService sets enabled: true (via updateService / direct check)
  test('enableService sets enabled to true', async () => {
    await portless.registerService('svc-f');
    portless.disableService('svc-f');
    portless.enableService('svc-f');
    // Re-fetch list to confirm persistence
    const svc = portless.listServices().find(s => s.name === 'svc-f');
    expect(svc.enabled).toBe(true);
  });

  // 6. disableService sets enabled: false
  test('disableService sets enabled to false', async () => {
    await portless.registerService('svc-g');
    portless.disableService('svc-g');
    const svc = portless.listServices().find(s => s.name === 'svc-g');
    expect(svc.enabled).toBe(false);
  });

  // 7. enableService with non-existent name throws
  test('enableService with non-existent name throws', () => {
    expect(() => portless.enableService('no-such-service')).toThrow();
  });

  // 8. disableService with non-existent name throws
  test('disableService with non-existent name throws', () => {
    expect(() => portless.disableService('no-such-service')).toThrow();
  });

  // 9. testService returns object with tcp property
  test('testService returns object with tcp property', async () => {
    await portless.registerService('svc-h');
    const result = await portless.testService('svc-h');
    expect(result).toHaveProperty('tcp');
    expect(result.tcp).toHaveProperty('open');
    expect(result.tcp).toHaveProperty('port');
  });

  // 10. registerService assigns port in 4000-4999 range when no port specified
  test('registerService assigns port within 4000-4999 range', async () => {
    const port = await portless.registerService('svc-i');
    expect(port).toBeGreaterThanOrEqual(4000);
    expect(port).toBeLessThanOrEqual(4999);
  });

  // 11. releaseService removes the service (listServices no longer includes it)
  test('releaseService removes the service from the registry', async () => {
    await portless.registerService('svc-j');
    portless.releaseService('svc-j');
    const services = portless.listServices();
    expect(services.find(s => s.name === 'svc-j')).toBeUndefined();
  });

  // 12. listServices returns [] when no services registered
  test('listServices returns empty array when no services registered', () => {
    const services = portless.listServices();
    expect(services).toEqual([]);
  });

  // 13. Registering same name twice returns existing port (idempotent)
  test('registering same name twice is idempotent — returns existing port', async () => {
    const port1 = await portless.registerService('svc-k');
    const port2 = await portless.registerService('svc-k');
    expect(port1).toBe(port2);
    const services = portless.listServices().filter(s => s.name === 'svc-k');
    expect(services).toHaveLength(1);
  });

  // 14. The portless data file is created on first registerService
  test('portless data file is created on first registerService', async () => {
    expect(fs.existsSync(PORTLESS_FILE)).toBe(false);
    await portless.registerService('svc-l');
    expect(fs.existsSync(PORTLESS_FILE)).toBe(true);
  });

  // 15. Multiple sequential registerService calls don't corrupt state
  test('multiple sequential registerService calls preserve all services', async () => {
    await portless.registerService('svc-m1');
    await portless.registerService('svc-m2');
    await portless.registerService('svc-m3');
    const services = portless.listServices();
    expect(services).toHaveLength(3);
    const names = services.map(s => s.name);
    expect(names).toContain('svc-m1');
    expect(names).toContain('svc-m2');
    expect(names).toContain('svc-m3');
    // All ports must be unique
    const ports = services.map(s => s.port);
    expect(new Set(ports).size).toBe(3);
  });
});
