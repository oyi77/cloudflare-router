const fs = require('fs');
const path = require('path');

const rateLimits = new Map();
const ipWhitelist = new Set();
const ipBlacklist = new Set();

function loadIPLists() {
  const configDir = path.join(process.env.HOME, '.cloudflare-router');
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
  const { windowMs = 60000, max = 100, message = 'Too many requests' } = options;
  
  return (req, res, next) => {
    const ip = getClientIP(req);
    
    if (!isIPAllowed(ip)) {
      return res.status(403).json({ error: 'IP blocked' });
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
      return res.status(429).json({ 
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
  const configDir = path.join(process.env.HOME, '.cloudflare-router');
  const whitelistFile = path.join(configDir, 'ip-whitelist.txt');
  fs.appendFileSync(whitelistFile, ip + '\n');
}

function addToBlacklist(ip) {
  ipBlacklist.add(ip);
  const configDir = path.join(process.env.HOME, '.cloudflare-router');
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
  const configDir = path.join(process.env.HOME, '.cloudflare-router');
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

module.exports = {
  rateLimitMiddleware,
  addToWhitelist,
  addToBlacklist,
  removeFromWhitelist,
  removeFromBlacklist,
  getIPLists,
  getRateLimitStats,
  getClientIP,
  isIPAllowed
};
