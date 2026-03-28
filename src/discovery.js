/**
 * discovery.js — Port scanner & service discovery for CF-Router
 *
 * Scans listening TCP ports on localhost, detects process names,
 * cross-references with existing CF-Router mappings.
 */

const { execSync } = require('child_process');
const { getAllMappings } = require('./config');

/**
 * Get all listening TCP ports with process info.
 * Uses `ss -tlnp` (preferred) with fallback to `netstat -tlnp`.
 * @returns {Array<{port, address, pid, process}>}
 */
function scanListeningPorts() {
  let output = '';
  try {
    output = execSync('ss -tlnp 2>/dev/null', { encoding: 'utf8' });
    return parseSsOutput(output);
  } catch {
    try {
      output = execSync('netstat -tlnp 2>/dev/null', { encoding: 'utf8' });
      return parseNetstatOutput(output);
    } catch {
      return [];
    }
  }
}

function parseSsOutput(output) {
  const ports = [];
  const lines = output.split('\n').slice(1); // skip header
  for (const line of lines) {
    if (!line.trim()) continue;
    // ss format: State Recv-Q Send-Q Local-Address:Port Peer-Address:Port Process
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;

    const localAddr = parts[3]; // e.g. 0.0.0.0:3000 or 127.0.0.1:5000 or *:7070
    const colonIdx = localAddr.lastIndexOf(':');
    if (colonIdx === -1) continue;

    const port = parseInt(localAddr.slice(colonIdx + 1));
    if (isNaN(port) || port <= 0) continue;

    const address = localAddr.slice(0, colonIdx);
    // Skip ports not on localhost or wildcard
    if (address !== '127.0.0.1' && address !== '0.0.0.0' && address !== '*' && address !== '::1' && address !== '[::]') continue;

    // Parse process info from users:(("name",pid=X,...)) or users:(("name",pid,fd))
    const processInfo = parts.slice(5).join(' ');
    const { pid, name } = extractProcessInfo(processInfo);

    if (!ports.find(p => p.port === port)) {
      ports.push({ port, address, pid, process: name });
    }
  }
  return ports.sort((a, b) => a.port - b.port);
}

function parseNetstatOutput(output) {
  const ports = [];
  const lines = output.split('\n').slice(2); // skip headers
  for (const line of lines) {
    if (!line.includes('LISTEN')) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;

    const localAddr = parts[3];
    const colonIdx = localAddr.lastIndexOf(':');
    if (colonIdx === -1) continue;

    const port = parseInt(localAddr.slice(colonIdx + 1));
    if (isNaN(port) || port <= 0) continue;

    const address = localAddr.slice(0, colonIdx);
    if (address !== '127.0.0.1' && address !== '0.0.0.0' && address !== '*') continue;

    const pidProcess = parts[6] || '';
    const [pid, name] = pidProcess.split('/');

    if (!ports.find(p => p.port === port)) {
      ports.push({ port, address, pid: pid || null, process: name || 'unknown' });
    }
  }
  return ports.sort((a, b) => a.port - b.port);
}

function extractProcessInfo(str) {
  if (!str) return { pid: null, name: 'unknown' };
  // ss format: users:(("node",pid=12345,fd=6))
  const nameMatch = str.match(/\("([^"]+)"/);
  const pidMatch = str.match(/pid=(\d+)/);
  return {
    name: nameMatch ? nameMatch[1] : 'unknown',
    pid: pidMatch ? parseInt(pidMatch[1]) : null
  };
}

/**
 * Get command line for a PID (for better process identification).
 */
function getProcessCmdline(pid) {
  if (!pid) return null;
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim().slice(0, 80);
  } catch {
    return null;
  }
}

/**
 * Main discovery function.
 * Returns all ports with mapping status.
 */
function discoverPorts() {
  const listeningPorts = scanListeningPorts();
  const mappings = getAllMappings();
  const mappedPorts = new Map();
  
  for (const m of mappings) {
    if (!mappedPorts.has(m.port)) {
      mappedPorts.set(m.port, { subdomain: m.full_domain, mapping: m });
    }
  }

  // Well-known port labels for common services
  const KNOWN_PORTS = {
    80: 'http', 443: 'https', 22: 'ssh', 21: 'ftp',
    3306: 'mysql', 5432: 'postgres', 6379: 'redis',
    27017: 'mongodb', 9200: 'elasticsearch',
    3000: 'node/react', 3001: 'node', 3002: 'node/api',
    4000: 'node', 5000: 'flask/python', 8000: 'python/django',
    8080: 'java/nginx', 8443: 'https-alt', 8888: 'jupyter',
    9000: 'php-fpm', 11434: 'ollama', 7070: 'cf-router',
  };

  return listeningPorts.map(p => {
    const mappingInfo = mappedPorts.get(p.port);
    const knownLabel = KNOWN_PORTS[p.port];
    const processLabel = p.process !== 'unknown' ? p.process : (knownLabel || 'unknown');
    
    return {
      port: p.port,
      address: p.address,
      pid: p.pid,
      process: processLabel,
      mapped: !!mappingInfo,
      subdomain: mappingInfo ? mappingInfo.subdomain : null,
      mapping: mappingInfo ? mappingInfo.mapping : null,
    };
  });
}

/**
 * Get only unmapped ports (candidates for new mappings).
 */
function getUnmappedPorts() {
  return discoverPorts().filter(p => !p.mapped);
}

// Skip system/infra ports that shouldn't be exposed
const SKIP_PORTS = new Set([22, 80, 443, 25, 53, 123, 111, 631, 3306, 5432]);

function getUnmappedCandidates() {
  return getUnmappedPorts().filter(p => !SKIP_PORTS.has(p.port) && p.port > 1024);
}

module.exports = { discoverPorts, getUnmappedPorts, getUnmappedCandidates, scanListeningPorts };
