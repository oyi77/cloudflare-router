const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./config');

const LOG_DIR = path.join(CONFIG_DIR, 'logs');
const ACCESS_LOG_FILE = path.join(LOG_DIR, 'access.log');
const ERROR_LOG_FILE = path.join(LOG_DIR, 'error.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function formatLogEntry(req, res, duration) {
  const timestamp = new Date().toISOString();
  const ip = req.headers['x-forwarded-for'] || req.ip || '-';
  const method = req.method;
  const url = req.originalUrl || req.url;
  const status = res.statusCode;
  const userAgent = req.headers['user-agent'] || '-';
  const contentLength = res.get('content-length') || 0;

  return JSON.stringify({
    timestamp,
    ip,
    method,
    url,
    status,
    duration: `${duration}ms`,
    contentLength,
    userAgent,
    referer: req.headers['referer'] || '-'
  });
}

function requestLoggerMiddleware(req, res, next) {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logEntry = formatLogEntry(req, res, duration);

    // Always write to access log
    fs.appendFile(ACCESS_LOG_FILE, logEntry + '\n', (err) => {
      if (err) console.error('Failed to write access log:', err);
    });

    // Write errors to separate error log
    if (res.statusCode >= 400) {
      fs.appendFile(ERROR_LOG_FILE, logEntry + '\n', (err) => {
        if (err) console.error('Failed to write error log:', err);
      });
    }
  });

  next();
}

function getAccessLogs(lines = 100) {
  try {
    if (!fs.existsSync(ACCESS_LOG_FILE)) return [];
    const content = fs.readFileSync(ACCESS_LOG_FILE, 'utf8');
    return content.trim().split('\n').slice(-lines).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function getErrorLogs(lines = 100) {
  try {
    if (!fs.existsSync(ERROR_LOG_FILE)) return [];
    const content = fs.readFileSync(ERROR_LOG_FILE, 'utf8');
    return content.trim().split('\n').slice(-lines).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function clearLogs() {
  if (fs.existsSync(ACCESS_LOG_FILE)) fs.unlinkSync(ACCESS_LOG_FILE);
  if (fs.existsSync(ERROR_LOG_FILE)) fs.unlinkSync(ERROR_LOG_FILE);
}

function getLogStats() {
  try {
    const accessLogs = getAccessLogs(10000);
    const totalRequests = accessLogs.length;
    const statusCodes = {};
    const ips = {};
    const endpoints = {};

    accessLogs.forEach(log => {
      // Status codes
      const statusGroup = Math.floor(log.status / 100) + 'xx';
      statusCodes[statusGroup] = (statusCodes[statusGroup] || 0) + 1;

      // IPs
      ips[log.ip] = (ips[log.ip] || 0) + 1;

      // Endpoints
      const endpoint = `${log.method} ${log.url.split('?')[0]}`;
      endpoints[endpoint] = (endpoints[endpoint] || 0) + 1;
    });

    // Top 10 IPs
    const topIPs = Object.entries(ips)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, count }));

    // Top 10 endpoints
    const topEndpoints = Object.entries(endpoints)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([endpoint, count]) => ({ endpoint, count }));

    return {
      totalRequests,
      statusCodes,
      topIPs,
      topEndpoints,
      logSize: fs.existsSync(ACCESS_LOG_FILE) ? fs.statSync(ACCESS_LOG_FILE).size : 0
    };
  } catch {
    return { totalRequests: 0, statusCodes: {}, topIPs: [], topEndpoints: [], logSize: 0 };
  }
}

module.exports = {
  requestLoggerMiddleware,
  getAccessLogs,
  getErrorLogs,
  clearLogs,
  getLogStats,
  LOG_DIR,
  ACCESS_LOG_FILE,
  ERROR_LOG_FILE
};
