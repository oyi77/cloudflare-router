const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');
const { execSync, exec } = require('child_process');
const net = require('net');
const tls = require('tls');
const { v4: uuidv4 } = require('uuid');
const { loadConfig, saveConfig, addAccount, removeAccount, addZoneToAccount, removeZoneFromAccount, addMapping, removeMapping, toggleMapping, getAllMappings, CONFIG_DIR, MAPPINGS_DIR } = require('./config');
const { generateAllNginxConfigs, getNginxStatus } = require('./nginx');
const { verifyAccount, discoverZones, deployMappingsForZone, listDNSRecords, listTunnelsForAccount } = require('./cloudflare');
const { rateLimitMiddleware, addToWhitelist, addToBlacklist, removeFromWhitelist, removeFromBlacklist, getIPLists, getRateLimitStats } = require('./middleware');
const { createBackup, restoreBackup, listBackups, runHealthCheck, getHealthHistory, startAutoBackup, getBackupConfig, saveBackupConfig } = require('./backup');
const { getAvailableLanguages, translate, i18nMiddleware } = require('./i18n');
const { requestLoggerMiddleware, getAccessLogs, getErrorLogs, clearLogs, getLogStats } = require('./logger');
const { registerService, getPort, releaseService, listServices, updateService } = require('./portless');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://static.cloudflareinsights.com"],
      connectSrc: ["'self'", "ws:", "wss:", "https://static.cloudflareinsights.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(i18nMiddleware);
app.use(requestLoggerMiddleware);

app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

function loadEnv() {
  const envPath = path.join(CONFIG_DIR, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const [key, ...val] = line.split('=');
      if (key && val.length) process.env[key.trim()] = val.join('=').trim();
    });
  }
}
loadEnv();

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

function authMiddleware(req, res, next) {
  if (!DASHBOARD_PASSWORD && !AUTH_TOKEN) return next();
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query?.token;
  if (token === AUTH_TOKEN || token === DASHBOARD_PASSWORD) return next();
  res.status(401).json({ error: 'Unauthorized', code: 'auth_required' });
}

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'validation_error',
      details: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

class APIError extends Error {
  constructor(message, statusCode = 500, code = 'internal_error') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, please try again later', code: 'rate_limit_exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests', code: 'rate_limit_exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiRateLimit);

app.post('/api/auth/login', authRateLimit, (req, res) => {
  const { password } = req.body;
  if (!DASHBOARD_PASSWORD) return res.json({ success: true, token: '' });
  if (password === DASHBOARD_PASSWORD) return res.json({ success: true, token: DASHBOARD_PASSWORD });
  res.status(401).json({ error: 'Invalid password' });
});

app.get('/api/auth/check', (req, res) => {
  res.json({ auth_required: !!DASHBOARD_PASSWORD || !!AUTH_TOKEN });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login' || req.path === '/auth/check') return next();
  authMiddleware(req, res, next);
});

const requestStats = { total: 0, success: 0, errors: 0, history: [] };
const healthChecks = new Map();
const webhooks = [];

const paginate = (items, page = 1, limit = 50) => {
  const start = (page - 1) * limit;
  const end = start + limit;
  return {
    data: items.slice(start, end),
    pagination: { page, limit, total: items.length, pages: Math.ceil(items.length / limit) }
  };
};

const validators = {
  account: {
    create: [
      body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name is required'),
      body('email').trim().isEmail().normalizeEmail().withMessage('Valid email required'),
      body('api_key').optional().trim().isLength({ min: 10 }),
      body('api_token').optional().trim().isLength({ min: 10 }),
    ],
    id: [param('id').trim().isLength({ min: 1 })],
  },
  zone: {
    create: [
      param('id').trim().isLength({ min: 1 }),
      body('zone_id').trim().isLength({ min: 1 }),
      body('domain').trim().isFQDN(),
    ],
    remove: [param('id').trim().isLength({ min: 1 }), param('zoneId').trim().isLength({ min: 1 })],
  },
  mapping: {
    create: [
      body('account_id').trim().isLength({ min: 1 }),
      body('zone_id').trim().isLength({ min: 1 }),
      body('subdomain').trim().isLength({ min: 1, max: 63 }).matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i),
      body('port').isInt({ min: 1, max: 65535 }),
    ],
    remove: [param('account').trim(), param('zone').trim(), param('subdomain').trim()],
    toggle: [body('enabled').isBoolean()],
  },
  list: [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('sort').optional().trim(),
    query('filter').optional().trim(),
  ],
};

app.use((req, res, next) => {
  requestStats.total++;
  const hour = new Date().toISOString().slice(0, 13);
  const entry = requestStats.history.find(h => h.hour === hour);
  if (entry) entry.count++;
  else requestStats.history.push({ hour, count: 1 });
  if (requestStats.history.length > 168) requestStats.history.shift();
  res.on('finish', () => {
    if (res.statusCode < 400) requestStats.success++;
    else requestStats.errors++;
  });
  next();
});

app.get('/api/accounts', asyncHandler(async (req, res) => {
  const config = loadConfig();
  const safe = (config.accounts || []).map(a => ({
    id: a.id, name: a.name, email: a.email,
    api_key_masked: a.api_key ? '...' + a.api_key.slice(-4) : (a.api_token ? '...' + a.api_token.slice(-4) : 'none'),
    zones: (a.zones || []).map(z => ({ zone_id: z.zone_id, domain: z.domain, tunnel_id: z.tunnel_id }))
  }));
  res.json(safe);
}));

app.post('/api/accounts', validators.account.create, handleValidationErrors, asyncHandler(async (req, res) => {
  const { name, email, api_key, api_token } = req.body;
  if (!api_key && !api_token) {
    throw new APIError('Either api_key or api_token required', 400, 'missing_credentials');
  }
  const accounts = addAccount(name, email, api_key || api_token);
  res.status(201).json({ success: true, accounts });
}));

app.delete('/api/accounts/:id', validators.account.id, handleValidationErrors, asyncHandler(async (req, res) => {
  removeAccount(req.params.id);
  res.json({ success: true });
}));

app.get('/api/accounts/:id/verify', validators.account.id, handleValidationErrors, asyncHandler(async (req, res) => {
  res.json(await verifyAccount(req.params.id));
}));

app.get('/api/accounts/:id/discover', validators.account.id, handleValidationErrors, asyncHandler(async (req, res) => {
  res.json(await discoverZones(req.params.id));
}));

app.post('/api/accounts/:id/zones', validators.zone.create, handleValidationErrors, asyncHandler(async (req, res) => {
  const { zone_id, domain, tunnel_id, tunnel_credentials } = req.body;
  const zones = addZoneToAccount(req.params.id, zone_id, domain, tunnel_id, tunnel_credentials);
  res.status(201).json({ success: true, zones });
}));

app.delete('/api/accounts/:id/zones/:zoneId', (req, res) => {
  try { removeZoneFromAccount(req.params.id, req.params.zoneId); res.json({ success: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/accounts/:id/zones/:zoneId/dns', async (req, res) => {
  try { res.json(await listDNSRecords(req.params.id, req.params.zoneId)); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/accounts/:id/tunnels', async (req, res) => {
  try { res.json(await listTunnelsForAccount(req.params.id)); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/dns/all', async (req, res) => {
  try {
    const config = loadConfig();
    const allDNS = [];
    for (const account of config.accounts || []) {
      for (const zone of account.zones || []) {
        try {
          const records = await listDNSRecords(account.id, zone.zone_id);
          records.forEach(r => allDNS.push({ ...r, account_name: account.name, account_id: account.id, zone_domain: zone.domain }));
        } catch (e) { }
      }
    }
    res.json(allDNS);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tunnels/all', async (req, res) => {
  try {
    const config = loadConfig();
    const allTunnels = [];
    for (const account of config.accounts || []) {
      try {
        const tunnels = await listTunnelsForAccount(account.id);
        tunnels.forEach(t => allTunnels.push({ ...t, account_name: account.name, account_id: account.id }));
      } catch (e) { }
    }
    res.json(allTunnels);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/mappings', validators.list, handleValidationErrors, asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, sort, filter } = req.query;
  let mappings = getAllMappings();

  if (filter) {
    const f = filter.toLowerCase();
    mappings = mappings.filter(m =>
      m.subdomain?.toLowerCase().includes(f) ||
      m.domain?.toLowerCase().includes(f) ||
      m.account_name?.toLowerCase().includes(f)
    );
  }

  if (sort) {
    const [field, order] = sort.split(':');
    mappings.sort((a, b) => {
      const aVal = a[field] || '';
      const bVal = b[field] || '';
      return order === 'desc' ? String(bVal).localeCompare(String(aVal)) : String(aVal).localeCompare(String(bVal));
    });
  }

  res.json(paginate(mappings, page, limit));
}));

app.post('/api/mappings', validators.mapping.create, handleValidationErrors, asyncHandler(async (req, res) => {
  const { account_id, zone_id, subdomain, port, description } = req.body;
  const mappings = addMapping(account_id, zone_id, subdomain, port, description || '');
  res.status(201).json({ success: true, mappings });
}));

app.delete('/api/mappings/:account/:zone/:subdomain', validators.mapping.remove, handleValidationErrors, asyncHandler(async (req, res) => {
  removeMapping(req.params.account, req.params.zone, req.params.subdomain);
  res.json({ success: true });
}));

app.patch('/api/mappings/:account/:zone/:subdomain', validators.mapping.remove, validators.mapping.toggle, handleValidationErrors, asyncHandler(async (req, res) => {
  toggleMapping(req.params.account, req.params.zone, req.params.subdomain, req.body.enabled);
  res.json({ success: true });
}));

app.put('/api/mappings/:account/:zone/:subdomain', validators.mapping.remove, handleValidationErrors, asyncHandler(async (req, res) => {
  const { enabled } = req.body;
  const mappings = toggleMapping(req.params.account, req.params.zone, req.params.subdomain, enabled);
  res.json({ success: true, mappings });
}));

app.post('/api/generate', (req, res) => {
  try { res.json({ success: true, ...generateAllNginxConfigs() }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/deploy', async (req, res) => {
  try {
    const config = loadConfig();
    const allResults = [];
    for (const account of config.accounts || []) {
      for (const zone of account.zones || []) {
        const { loadMappings } = require('./config');
        const { mappings } = loadMappings(account.id, zone.zone_id);
        const results = await deployMappingsForZone(account.id, zone.zone_id, zone.domain, zone.tunnel_id, mappings);
        allResults.push({ account: account.name, zone: zone.domain, results });
      }
    }
    res.json({ success: true, results: allResults });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/status', (req, res) => {
  try {
    const config = loadConfig();
    const mappings = getAllMappings();
    res.json({
      nginx: getNginxStatus(),
      accounts: config.accounts?.length || 0,
      zones: config.accounts?.reduce((s, a) => s + (a.zones?.length || 0), 0) || 0,
      mappings: mappings.length,
      enabled: mappings.filter(m => m.enabled !== false).length
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/stats', (req, res) => {
  res.json(requestStats);
});

app.get('/api/languages', (req, res) => {
  res.json(getAvailableLanguages());
});

app.get('/api/translate/:key', (req, res) => {
  res.json({ key: req.params.key, value: translate(req.params.key, req.query.lang || 'en') });
});

app.get('/api/translations', (req, res) => {
  const lang = req.query.lang || 'en';
  const { languages } = require('./i18n');
  const langData = languages[lang] || languages.en;
  res.json({ lang, translations: langData.translations });
});

// Logging endpoints
app.get('/api/logs/access', (req, res) => {
  const lines = parseInt(req.query.lines) || 100;
  res.json(getAccessLogs(lines));
});

app.get('/api/logs/errors', (req, res) => {
  const lines = parseInt(req.query.lines) || 100;
  res.json(getErrorLogs(lines));
});

app.get('/api/logs/stats', (req, res) => {
  res.json(getLogStats());
});

app.delete('/api/logs', (req, res) => {
  clearLogs();
  res.json({ success: true });
});

app.get('/api/ip/lists', (req, res) => {
  res.json(getIPLists());
});

app.post('/api/ip/whitelist', [body('ip').trim().isIP().withMessage('Valid IP address required')], handleValidationErrors, (req, res) => {
  addToWhitelist(req.body.ip);
  res.json({ success: true });
});

app.post('/api/ip/blacklist', [body('ip').trim().isIP().withMessage('Valid IP address required')], handleValidationErrors, (req, res) => {
  addToBlacklist(req.body.ip);
  res.json({ success: true });
});

app.delete('/api/ip/whitelist/:ip', (req, res) => {
  removeFromWhitelist(req.params.ip);
  res.json({ success: true });
});

app.delete('/api/ip/blacklist/:ip', (req, res) => {
  removeFromBlacklist(req.params.ip);
  res.json({ success: true });
});

app.get('/api/rate-limit/stats', (req, res) => {
  res.json(getRateLimitStats());
});

app.post('/api/backup/create', (req, res) => {
  try {
    const backup = createBackup();
    res.json({ success: true, ...backup });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/backup/list', (req, res) => {
  res.json(listBackups());
});

app.post('/api/backup/restore', (req, res) => {
  try {
    const { file } = req.body;
    const backupDir = path.join(CONFIG_DIR, 'backups');
    const result = restoreBackup(path.join(backupDir, file));
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/backup/config', (req, res) => {
  res.json(getBackupConfig());
});

app.put('/api/backup/config', (req, res) => {
  saveBackupConfig(req.body);
  res.json({ success: true });
});

app.post('/api/health-check/run', (req, res) => {
  const { urls } = req.body;
  const results = runHealthCheck(urls || []);
  res.json(results);
});

app.get('/api/health-check/history', (req, res) => {
  res.json(getHealthHistory(parseInt(req.query.hours) || 24));
});

app.get('/api/nginx/configs', (req, res) => {
  try {
    const sitesDir = path.join(CONFIG_DIR, 'nginx', 'sites');
    if (!fs.existsSync(sitesDir)) return res.json([]);
    const configs = fs.readdirSync(sitesDir).filter(f => f.endsWith('.conf')).map(f => ({
      file: f,
      content: fs.readFileSync(path.join(sitesDir, f), 'utf8')
    }));
    res.json(configs);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/nginx/configs/:file', (req, res) => {
  try {
    const sitesDir = path.join(CONFIG_DIR, 'nginx', 'sites');
    const filePath = path.join(sitesDir, req.params.file);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Config not found' });
    fs.writeFileSync(filePath, req.body.content);
    res.json({ success: true, file: req.params.file });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/nginx/reload', (req, res) => {
  try {
    const nginxConf = path.join(CONFIG_DIR, 'nginx', 'nginx.conf');
    execSync(`nginx -t -c ${nginxConf} 2>&1`, { encoding: 'utf8', timeout: 5000 });
    execSync(`nginx -s reload -c ${nginxConf} 2>&1`, { encoding: 'utf8', timeout: 5000 });
    res.json({ success: true, message: 'Nginx reloaded' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

const APPS_YAML = path.join(CONFIG_DIR, 'apps.yaml');

app.get('/api/apps', (req, res) => {
  try {
    if (!fs.existsSync(APPS_YAML)) return res.json({ apps: {} });
    const yaml = require('js-yaml');
    const data = yaml.load(fs.readFileSync(APPS_YAML, 'utf8'));
    res.json(data || { apps: {} });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/apps', (req, res) => {
  try {
    const yaml = require('js-yaml');
    fs.writeFileSync(APPS_YAML, yaml.dump(req.body, { lineWidth: -1 }));
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/apps/:name', (req, res) => {
  try {
    const yaml = require('js-yaml');
    const data = fs.existsSync(APPS_YAML) ? yaml.load(fs.readFileSync(APPS_YAML, 'utf8')) : { apps: {} };
    data.apps = data.apps || {};
    data.apps[req.params.name] = req.body;
    fs.writeFileSync(APPS_YAML, yaml.dump(data, { lineWidth: -1 }));
    res.json({ success: true, app: req.params.name });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/apps/:name', (req, res) => {
  try {
    const yaml = require('js-yaml');
    const data = fs.existsSync(APPS_YAML) ? yaml.load(fs.readFileSync(APPS_YAML, 'utf8')) : { apps: {} };
    delete data.apps[req.params.name];
    fs.writeFileSync(APPS_YAML, yaml.dump(data, { lineWidth: -1 }));
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/health-check/add', (req, res) => {
  const { url, name, interval } = req.body;
  const id = Date.now().toString();
  healthChecks.set(id, { id, url, name: name || url, interval: interval || 30000, status: 'pending', lastCheck: null });
  executeHealthCheck(id);
  res.json({ success: true, id });
});

app.delete('/api/health-check/:id', (req, res) => {
  healthChecks.delete(req.params.id);
  res.json({ success: true });
});

app.get('/api/health-checks', (req, res) => {
  res.json([...healthChecks.values()]);
});

function executeHealthCheck(id) {
  const check = healthChecks.get(id);
  if (!check) return;
  const startTime = Date.now();
  exec(`curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${check.url}"`, (err, stdout) => {
    const elapsed = Date.now() - startTime;
    check.status = (!err && stdout.trim() === '200') ? 'healthy' : 'unhealthy';
    check.latency = elapsed;
    check.lastCheck = new Date().toISOString();
    if (check.status === 'unhealthy' && WEBHOOK_URL) {
      sendWebhook(`Health check failed: ${check.name} (${check.url})`);
    }
  });
  setTimeout(() => executeHealthCheck(id), check.interval);
}

app.get('/api/ssl/all', async (req, res) => {
  try {
    // Collect domains from mappings, nginx configs, and apps.yaml
    const domains = new Set();
    try { getAllMappings().forEach(m => { if (m.full_domain) domains.add(m.full_domain); }); } catch (e) {}
    try {
      const sitesDir = path.join(CONFIG_DIR, 'nginx', 'sites');
      if (fs.existsSync(sitesDir)) {
        fs.readdirSync(sitesDir).filter(f => f.endsWith('.conf')).forEach(f => {
          const content = fs.readFileSync(path.join(sitesDir, f), 'utf8');
          const match = content.match(/server_name\s+([^;]+);/);
          if (match) match[1].split(/\s+/).forEach(d => { if (d !== '_' && d.includes('.')) domains.add(d); });
        });
      }
    } catch (e) {}
    const results = [];
    for (const domain of [...domains].slice(0, 30)) {
      try {
        const result = execSync(`echo | openssl s_client -connect ${domain}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -dates 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
        const notAfter = result.split('\n').find(l => l.startsWith('notAfter='))?.split('=')[1];
        const days = notAfter ? Math.floor((new Date(notAfter) - new Date()) / 86400000) : null;
        results.push({ domain, expires: notAfter, daysUntilExpiry: days, status: days < 30 ? 'warning' : 'ok' });
      } catch (e) { results.push({ domain, error: 'Could not fetch SSL info' }); }
    }
    res.json(results);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/ssl/:domain', async (req, res) => {
  try {
    const domain = req.params.domain;
    const result = execSync(`echo | openssl s_client -connect ${domain}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -dates -subject -issuer 2>/dev/null`, { encoding: 'utf8', timeout: 10000 });
    const lines = result.split('\n').filter(Boolean);
    const ssl = {};
    lines.forEach(line => {
      if (line.startsWith('notBefore=')) ssl.notBefore = line.split('=')[1];
      if (line.startsWith('notAfter=')) ssl.notAfter = line.split('=')[1];
      if (line.startsWith('subject=')) ssl.subject = line.split('=')[1];
      if (line.startsWith('issuer=')) ssl.issuer = line.split('=')[1];
    });
    if (ssl.notAfter) {
      const expiry = new Date(ssl.notAfter);
      ssl.daysUntilExpiry = Math.floor((expiry - new Date()) / 86400000);
    }
    res.json({ domain, ...ssl });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tunnel/restart', (req, res) => {
  try {
    const { configPath } = req.body;
    const config = configPath || path.join(process.env.HOME, '.cloudflared', 'config.yml');
    execSync(`pkill -f "cloudflared.*${path.basename(config)}" 2>/dev/null; sleep 1; nohup cloudflared tunnel --config ${config} run &`, { timeout: 5000 });
    res.json({ success: true, message: 'Tunnel restarting...' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tunnel/restart-all', (req, res) => {
  try {
    execSync('pkill -f cloudflared 2>/dev/null; sleep 2', { timeout: 5000 });
    const configDir = path.join(process.env.HOME, '.cloudflared');
    fs.readdirSync(configDir).filter(f => f.endsWith('.yml')).forEach(f => {
      exec(`nohup cloudflared tunnel --config ${path.join(configDir, f)} run &`);
    });
    res.json({ success: true, message: 'All tunnels restarting...' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/config/export', (req, res) => {
  try {
    const config = loadConfig();
    const safeConfig = { ...config };
    if (safeConfig.accounts) {
      safeConfig.accounts = safeConfig.accounts.map(a => ({ ...a, api_key: '***', api_token: '***' }));
    }
    const mappings = {};
    if (fs.existsSync(MAPPINGS_DIR)) {
      fs.readdirSync(MAPPINGS_DIR).filter(f => f.endsWith('.yml')).forEach(f => {
        mappings[f] = fs.readFileSync(path.join(MAPPINGS_DIR, f), 'utf8');
      });
    }
    res.json({ config: safeConfig, mappings, exportedAt: new Date().toISOString() });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/config/import', (req, res) => {
  try {
    const { config, mappings } = req.body;
    if (config) saveConfig(config);
    if (mappings) {
      Object.entries(mappings).forEach(([filename, content]) => {
        fs.writeFileSync(path.join(MAPPINGS_DIR, filename), content);
      });
    }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/webhooks', (req, res) => {
  res.json(webhooks);
});

app.post('/api/webhooks', (req, res) => {
  const { url, events } = req.body;
  webhooks.push({ id: Date.now().toString(), url, events: events || ['health.down', 'deploy.complete'], active: true });
  res.json({ success: true });
});

app.delete('/api/webhooks/:id', (req, res) => {
  const idx = webhooks.findIndex(w => w.id === req.params.id);
  if (idx >= 0) webhooks.splice(idx, 1);
  res.json({ success: true });
});

function sendWebhook(message, event = 'alert') {
  if (!WEBHOOK_URL) return;
  exec(`curl -s -X POST -H "Content-Type: application/json" -d '{"text":"${message}","event":"${event}"}' "${WEBHOOK_URL}"`, () => {});
}

app.post('/api/scan-ports', (req, res) => {
  const { ports } = req.body;
  const portsToScan = ports || [80, 443, 3000, 3001, 3002, 3003, 5432, 6379, 6969, 7070, 8080, 8443];
  const results = [];
  let completed = 0;
  portsToScan.forEach(port => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      results.push({ port, status: 'open' });
      if (++completed === portsToScan.length) res.json(results);
    });
    socket.on('error', () => {
      results.push({ port, status: 'closed' });
      if (++completed === portsToScan.length) res.json(results);
    });
    socket.on('timeout', () => {
      socket.destroy();
      results.push({ port, status: 'timeout' });
      if (++completed === portsToScan.length) res.json(results);
    });
    socket.connect(port, '127.0.0.1');
  });
});

const SERVERS_FILE = path.join(CONFIG_DIR, 'servers.yml');

function loadServers() {
  if (!fs.existsSync(SERVERS_FILE)) return { servers: [] };
  return yaml.load(fs.readFileSync(SERVERS_FILE, 'utf8')) || { servers: [] };
}

function saveServers(data) {
  fs.writeFileSync(SERVERS_FILE, yaml.dump(data, { indent: 2 }));
}

app.get('/api/servers', (req, res) => {
  res.json(loadServers());
});

app.post('/api/servers', [
  body('name').trim().isLength({ min: 1, max: 100 }),
  body('type').isIn(['local', 'ssh']),
  body('host').optional().trim(),
  body('port').optional().isInt({ min: 1, max: 65535 }),
  body('username').optional().trim(),
  body('keyPath').optional().trim(),
], handleValidationErrors, (req, res) => {
  const data = loadServers();
  const server = {
    id: uuidv4(),
    ...req.body,
    created_at: new Date().toISOString(),
  };
  data.servers.push(server);
  saveServers(data);
  res.status(201).json({ success: true, server });
});

app.put('/api/servers/:id', [
  param('id').trim().isUUID(),
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
  body('host').optional().trim(),
  body('port').optional().isInt({ min: 1, max: 65535 }),
], handleValidationErrors, (req, res) => {
  const data = loadServers();
  const server = data.servers.find(s => s.id === req.params.id);
  if (!server) throw new APIError('Server not found', 404, 'not_found');
  Object.assign(server, req.body, { updated_at: new Date().toISOString() });
  saveServers(data);
  res.json({ success: true, server });
});

app.delete('/api/servers/:id', [param('id').trim().isUUID()], handleValidationErrors, (req, res) => {
  const data = loadServers();
  data.servers = data.servers.filter(s => s.id !== req.params.id);
  saveServers(data);
  res.json({ success: true });
});

app.get('/api/portless', (req, res) => {
  res.json({ services: listServices() });
});

app.post('/api/portless', [
  body('name').trim().matches(/^[a-z0-9-_]+$/i),
  body('subdomain').optional().trim(),
  body('description').optional().trim(),
], handleValidationErrors, asyncHandler(async (req, res) => {
  const { name, subdomain, description } = req.body;
  const port = await registerService(name, { subdomain, description });
  res.status(201).json({ success: true, name, port });
}));

app.delete('/api/portless/:name', [param('name').trim().matches(/^[a-z0-9-_]+$/i)], handleValidationErrors, (req, res) => {
  releaseService(req.params.name);
  res.json({ success: true });
});

const APP_PROCESSES = new Map();

app.post('/api/apps/:name/start', [param('name').trim()], handleValidationErrors, asyncHandler(async (req, res) => {
  const yaml = require('js-yaml');
  const appsFile = path.join(CONFIG_DIR, 'apps.yml');
  if (!fs.existsSync(appsFile)) throw new APIError('No apps configured', 404, 'not_found');
  
  const data = yaml.load(fs.readFileSync(appsFile, 'utf8'));
  const app = data.apps?.[req.params.name];
  if (!app) throw new APIError('App not found', 404, 'not_found');
  
  if (APP_PROCESSES.has(req.params.name)) {
    return res.json({ success: true, message: 'App already running', pid: APP_PROCESSES.get(req.params.name).pid });
  }
  
  let command;
  if (app.command) {
    command = app.command;
  } else if (app.mode === 'portless') {
    const port = getPort(req.params.name) || await registerService(req.params.name);
    command = `PORT=${port} ${app.script || 'npm start'}`;
  } else {
    command = app.script || 'npm start';
  }
  
  const cwd = app.cwd || path.join(process.env.HOME, 'apps', req.params.name);
  const child = exec(command, { cwd, env: { ...process.env, ...app.env } });
  
  APP_PROCESSES.set(req.params.name, {
    pid: child.pid,
    started_at: new Date().toISOString(),
    command,
  });
  
  child.on('exit', (code) => {
    APP_PROCESSES.delete(req.params.name);
    console.log(`App ${req.params.name} exited with code ${code}`);
  });
  
  res.json({ success: true, pid: child.pid });
}));

app.post('/api/apps/:name/stop', [param('name').trim()], handleValidationErrors, (req, res) => {
  const proc = APP_PROCESSES.get(req.params.name);
  if (!proc) {
    return res.status(400).json({ error: 'App not running', code: 'not_running' });
  }
  
  try {
    process.kill(proc.pid, 'SIGTERM');
    APP_PROCESSES.delete(req.params.name);
    res.json({ success: true });
  } catch (e) {
    throw new APIError('Failed to stop app: ' + e.message, 500, 'stop_failed');
  }
});

app.get('/api/apps/:name/status', [param('name').trim()], handleValidationErrors, (req, res) => {
  const proc = APP_PROCESSES.get(req.params.name);
  res.json({
    name: req.params.name,
    running: !!proc,
    pid: proc?.pid || null,
    started_at: proc?.started_at || null,
  });
});

app.get('/api/apps/:name/logs', [param('name').trim(), query('lines').optional().isInt({ min: 1, max: 1000 }).toInt()], handleValidationErrors, (req, res) => {
  const lines = req.query.lines || 100;
  const logFile = path.join(CONFIG_DIR, 'logs', `app-${req.params.name}.log`);
  
  if (!fs.existsSync(logFile)) {
    return res.json({ logs: [] });
  }
  
  const logs = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-lines);
  res.json({ logs });
});

app.get('/api/settings', (req, res) => {
  const config = loadConfig();
  res.json({
    server: config.server || { port: 7070, host: '0.0.0.0' },
    nginx: config.nginx || { listen_port: 6969 },
    features: {
      rate_limiting: true,
      validation: true,
      file_locking: true,
    },
  });
});

app.put('/api/settings', [
  body('server.port').optional().isInt({ min: 1024, max: 65535 }),
  body('server.host').optional().isIP(),
  body('nginx.listen_port').optional().isInt({ min: 1, max: 65535 }),
], handleValidationErrors, (req, res) => {
  const config = loadConfig();
  if (req.body.server) config.server = { ...config.server, ...req.body.server };
  if (req.body.nginx) config.nginx = { ...config.nginx, ...req.body.nginx };
  saveConfig(config);
  res.json({ success: true });
});

app.use((err, req, res, next) => {
  if (err instanceof APIError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message, code: 'validation_error' });
  }
  console.error(`Error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error', code: 'internal_error' });
});

app.use('/', express.static(path.join(__dirname, 'dashboard')));

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });
  const clients = new Set();
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'stats', data: requestStats }));
    ws.send(JSON.stringify({ type: 'health', data: [...healthChecks.values()] }));
    ws.on('close', () => clients.delete(ws));
  });
  setInterval(() => {
    const data = JSON.stringify({ type: 'stats', data: requestStats });
    clients.forEach(ws => { try { ws.send(data); } catch (e) { } });
  }, 5000);
  setInterval(() => {
    const data = JSON.stringify({ type: 'health', data: [...healthChecks.values()] });
    clients.forEach(ws => { try { ws.send(data); } catch (e) { } });
  }, 10000);
}

function startServer(port = 7070) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    setupWebSocket(server);
    server.listen(port, '0.0.0.0', () => {
      console.log(`Dashboard: http://localhost:${port}`);
      console.log(`WebSocket: ws://localhost:${port}`);
      if (DASHBOARD_PASSWORD) console.log(`Auth: Password protected`);
      resolve(server);
    });
  });
}

module.exports = { app, startServer };
