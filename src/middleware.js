const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { CONFIG_DIR, API_RATE_WINDOW_MS, API_RATE_LIMIT_MAX } = require('./constants');

// AsyncLocalStorage for request context propagation (requestId, etc.)
const requestContext = new AsyncLocalStorage();

const rateLimits = new Map();
const ipWhitelist = new Set();
const ipBlacklist = new Set();

function loadIPLists() {
   const configDir = CONFIG_DIR;
  const whitelistFile = path.join(configDir, 'ip-whitelist.txt');
  const blacklistFile = path.join(configDir, 'ip-blacklist.txt');
  
  if (fs.existsSync(whitelistFile)) {
    fs.readFileSync(whitelistFile, 'utf8').split('\n').forEach(ip => {
      if (ip.trim() && !ip.startsWith('#')) ipWhitelist.add(ip.trim());
    });
  }
  
  if (fs.existsSync(blacklistFile)) {
    fs.readFileSync(blacklistFile, 'utf8').split('\n').forEach(ip => {
      if (ip.trim() && !ip.startsWith('#')) ipBlacklist.add(ip.trim());
    });
  }
}

loadIPLists();

setInterval(() => {
   const now = Date.now();
   const CLEANUP_WINDOW = 60 * 60 * 1000;
   for (const [key, timestamps] of rateLimits.entries()) {
     const recentTimestamps = timestamps.filter(t => now - t < CLEANUP_WINDOW);
     if (recentTimestamps.length === 0) {
       rateLimits.delete(key);
     } else if (recentTimestamps.length < timestamps.length) {
       rateLimits.set(key, recentTimestamps);
     }
   }
 }, 30 * 60 * 1000).unref(); // cleanup every 30 minutes

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         req.ip;
}

function isIPAllowed(ip) {
  if (ipBlacklist.has(ip)) return false;
  if (ipWhitelist.size === 0) return true;
  return ipWhitelist.has(ip) || ipWhitelist.has('*');
}

function rateLimitMiddleware(options = {}) {
   const { windowMs = API_RATE_WINDOW_MS, max = API_RATE_LIMIT_MAX, message = 'Too many requests' } = options;
  
  return (req, res, next) => {
    const ip = getClientIP(req);
    
     if (!isIPAllowed(ip)) {
       const { HTTP_FORBIDDEN } = require('./constants');
       return res.status(HTTP_FORBIDDEN).json({ error: 'IP blocked' });
     }
    
    if (ipWhitelist.has(ip)) return next();
    
    const key = `${ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    
    if (!rateLimits.has(key)) {
      rateLimits.set(key, []);
    }
    
    const timestamps = rateLimits.get(key).filter(t => t > windowStart);
    rateLimits.set(key, timestamps);
    
     if (timestamps.length >= max) {
       const { HTTP_TOO_MANY_REQUESTS } = require('./constants');
       return res.status(HTTP_TOO_MANY_REQUESTS).json({
         error: message,
         retryAfter: Math.ceil((timestamps[0] + windowMs - now) / 1000)
       });
     }
    
    timestamps.push(now);
    next();
  };
}

function addToWhitelist(ip) {
  ipWhitelist.add(ip);
  const configDir = path.join(process.env.HOME, 'projects/cf-router');
  const whitelistFile = path.join(configDir, 'ip-whitelist.txt');
  fs.appendFileSync(whitelistFile, ip + '\n');
}

function addToBlacklist(ip) {
  ipBlacklist.add(ip);
  const configDir = path.join(process.env.HOME, 'projects/cf-router');
  const blacklistFile = path.join(configDir, 'ip-blacklist.txt');
  fs.appendFileSync(blacklistFile, ip + '\n');
}

function removeFromWhitelist(ip) {
  ipWhitelist.delete(ip);
  saveIPLists();
}

function removeFromBlacklist(ip) {
  ipBlacklist.delete(ip);
  saveIPLists();
}

function saveIPLists() {
  const configDir = path.join(process.env.HOME, 'projects/cf-router');
  fs.writeFileSync(path.join(configDir, 'ip-whitelist.txt'), [...ipWhitelist].join('\n'));
  fs.writeFileSync(path.join(configDir, 'ip-blacklist.txt'), [...ipBlacklist].join('\n'));
}

function getIPLists() {
  return {
    whitelist: [...ipWhitelist],
    blacklist: [...ipBlacklist]
  };
}

function getRateLimitStats() {
  const stats = {};
  rateLimits.forEach((timestamps, ip) => {
    stats[ip] = {
      requests: timestamps.length,
      lastRequest: new Date(Math.max(...timestamps)).toISOString()
    };
  });
  return stats;
}

/**
 * Request ID middleware — assigns unique ID per request, propagates via X-Request-ID header.
 * Allows tracing requests across logs, audit, and errors.
 */
function requestIdMiddleware(req, res, next) {
  const id = req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex');
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
}

/**
 * Request context middleware — stores requestId in AsyncLocalStorage.
 * Allows logger, audit, and other functions to retrieve requestId without prop drilling.
 */
function requestContextMiddleware(req, res, next) {
  requestContext.run({ requestId: req.requestId }, () => next());
}

/**
 * Retrieve the current request ID from AsyncLocalStorage.
 * Returns null if called outside a request context.
 */
function getRequestId() {
  const store = requestContext.getStore();
  return store ? store.requestId : null;
}

module.exports = {
  rateLimitMiddleware,
  addToWhitelist,
  addToBlacklist,
  removeFromWhitelist,
  removeFromBlacklist,
  getIPLists,
  getRateLimitStats,
  getClientIP,
  isIPAllowed,
  requestIdMiddleware,
  requestContextMiddleware,
  getRequestId,
  requestContext
};
