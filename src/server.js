const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');
const { execSync, exec } = require('child_process');
const net = require('net');
const tls = require('tls');
const { loadConfig, saveConfig, addAccount, removeAccount, addZoneToAccount, removeZoneFromAccount, addMapping, removeMapping, toggleMapping, getAllMappings, CONFIG_DIR, MAPPINGS_DIR } = require('./config');
const { generateAllNginxConfigs, getNginxStatus } = require('./nginx');
const { verifyAccount, discoverZones, deployMappingsForZone, listDNSRecords, listTunnelsForAccount } = require('./cloudflare');
const { rateLimitMiddleware, addToWhitelist, addToBlacklist, removeFromWhitelist, removeFromBlacklist, getIPLists, getRateLimitStats } = require('./middleware');
const { createBackup, restoreBackup, listBackups, runHealthCheck, getHealthHistory, startAutoBackup, getBackupConfig, saveBackupConfig } = require('./backup');
const { getAvailableLanguages, translate, i18nMiddleware } = require('./i18n');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(rateLimitMiddleware({ windowMs: 60000, max: 100 }));
app.use(i18nMiddleware);

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

app.post('/api/auth/login', (req, res) => {
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

app.get('/api/accounts', (req, res) => {
  try {
    const config = loadConfig();
    const safe = (config.accounts || []).map(a => ({
      id: a.id, name: a.name, email: a.email,
      api_key_masked: a.api_key ? '...' + a.api_key.slice(-4) : (a.api_token ? '...' + a.api_token.slice(-4) : 'none'),
      zones: (a.zones || []).map(z => ({ zone_id: z.zone_id, domain: z.domain, tunnel_id: z.tunnel_id }))
    }));
    res.json(safe);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/accounts', (req, res) => {
  try {
    const { name, email, api_key, api_token } = req.body;
    const accounts = addAccount(name, email, api_key || api_token);
    res.json({ success: true, accounts });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/accounts/:id', (req, res) => {
  try { removeAccount(req.params.id); res.json({ success: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/accounts/:id/verify', async (req, res) => {
  try { res.json(await verifyAccount(req.params.id)); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/accounts/:id/discover', async (req, res) => {
  try { res.json(await discoverZones(req.params.id)); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/accounts/:id/zones', (req, res) => {
  try {
    const { zone_id, domain, tunnel_id, tunnel_credentials } = req.body;
    const zones = addZoneToAccount(req.params.id, zone_id, domain, tunnel_id, tunnel_credentials);
    res.json({ success: true, zones });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

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

app.get('/api/mappings', (req, res) => {
  try { res.json(getAllMappings()); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/mappings', (req, res) => {
  try {
    const { account_id, zone_id, subdomain, port, description } = req.body;
    if (!account_id || !zone_id || !subdomain || !port) return res.status(400).json({ error: 'Missing fields' });
    const mappings = addMapping(account_id, zone_id, subdomain, port, description || '');
    res.json({ success: true, mappings });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/mappings/:account/:zone/:subdomain', (req, res) => {
  try { removeMapping(req.params.account, req.params.zone, req.params.subdomain); res.json({ success: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/mappings/:account/:zone/:subdomain', (req, res) => {
  try { toggleMapping(req.params.account, req.params.zone, req.params.subdomain, req.body.enabled); res.json({ success: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

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

app.get('/api/ip/lists', (req, res) => {
  res.json(getIPLists());
});

app.post('/api/ip/whitelist', (req, res) => {
  const { ip } = req.body;
  addToWhitelist(ip);
  res.json({ success: true });
});

app.post('/api/ip/blacklist', (req, res) => {
  const { ip } = req.body;
  addToBlacklist(ip);
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

app.get('/api/ssl/all', async (req, res) => {
  try {
    const mappings = getAllMappings();
    const domains = [...new Set(mappings.map(m => m.full_domain))];
    const results = [];
    for (const domain of domains.slice(0, 20)) {
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
