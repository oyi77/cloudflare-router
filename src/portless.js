/**
 * portless.js — Port Registry for Cloudflare Router
 *
 * Portless architecture: services register by name, cf-router allocates ports.
 * Apps never hardcode ports — they query: PORT=$(cfr port:get my-service)
 *
 * Port range: 4000-4999 (portless range, isolated from legacy services)
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const net = require('net');

const CONFIG_DIR = path.join(process.env.HOME, '.cloudflare-router');
const PORTLESS_FILE = path.join(CONFIG_DIR, 'portless.yml');

const PORT_RANGE_START = 4000;
const PORT_RANGE_END = 4999;

// ── Storage ──────────────────────────────────────────────────────────────────

function loadPortless() {
  if (!fs.existsSync(PORTLESS_FILE)) return { services: {} };
  try {
    return yaml.load(fs.readFileSync(PORTLESS_FILE, 'utf8')) || { services: {} };
  } catch {
    return { services: {} };
  }
}

function savePortless(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(PORTLESS_FILE, yaml.dump(data, { indent: 2 }));
}

// ── Port allocation ───────────────────────────────────────────────────────────

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}

async function findFreePort(usedPorts) {
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (usedPorts.includes(p)) continue;
    if (await isPortFree(p)) return p;
  }
  throw new Error(`No free ports available in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register a service and allocate a port.
 * If service already registered, returns existing port (idempotent).
 * 
 * @param {string} serviceName   Unique service identifier (e.g., "1ai-backend")
 * @param {object} opts          { subdomain, description, account, zone }
 * @returns {number}             Allocated port
 */
async function registerService(serviceName, opts = {}) {
  const data = loadPortless();
  if (!data.services) data.services = {};

  // Already registered — return existing port
  if (data.services[serviceName]) {
    return data.services[serviceName].port;
  }

  const usedPorts = Object.values(data.services).map(s => s.port);
  const port = await findFreePort(usedPorts);

  data.services[serviceName] = {
    port,
    subdomain: opts.subdomain || null,
    description: opts.description || '',
    account: opts.account || null,
    zone: opts.zone || null,
    registered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  savePortless(data);
  return port;
}

/**
 * Get port for a registered service.
 * @param {string} serviceName
 * @returns {number|null}
 */
function getPort(serviceName) {
  const data = loadPortless();
  const svc = (data.services || {})[serviceName];
  return svc ? svc.port : null;
}

/**
 * Release a service's port registration.
 * @param {string} serviceName
 */
function releaseService(serviceName) {
  const data = loadPortless();
  if (!data.services || !data.services[serviceName]) {
    throw new Error(`Service not registered: ${serviceName}`);
  }
  const port = data.services[serviceName].port;
  delete data.services[serviceName];
  savePortless(data);
  return port;
}

/**
 * List all registered services.
 * @returns {Array}
 */
function listServices() {
  const data = loadPortless();
  return Object.entries(data.services || {}).map(([name, svc]) => ({
    name,
    ...svc,
  }));
}

/**
 * Update service metadata without changing port.
 * @param {string} serviceName
 * @param {object} updates
 */
function updateService(serviceName, updates) {
  const data = loadPortless();
  if (!data.services || !data.services[serviceName]) {
    throw new Error(`Service not registered: ${serviceName}`);
  }
  Object.assign(data.services[serviceName], updates, { updated_at: new Date().toISOString() });
  savePortless(data);
  return data.services[serviceName];
}

/**
 * Get the full portless registry as a flat env map.
 * Used to inject into shell scripts.
 * e.g., { PORT_1AI_BACKEND: 4001, PORT_1AI_LANDING: 4002, ... }
 */
function getEnvMap() {
  const services = listServices();
  const env = {};
  services.forEach(svc => {
    const key = 'PORT_' + svc.name.toUpperCase().replace(/[-_.]/g, '_');
    env[key] = svc.port;
  });
  return env;
}

module.exports = {
  registerService,
  getPort,
  releaseService,
  listServices,
  updateService,
  getEnvMap,
  PORT_RANGE_START,
  PORT_RANGE_END,
};
