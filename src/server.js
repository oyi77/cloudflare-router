const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { loadConfig, addAccount, removeAccount, addZoneToAccount, removeZoneFromAccount, addMapping, removeMapping, toggleMapping, getAllMappings } = require('./config');
const { generateAllNginxConfigs, getNginxStatus } = require('./nginx');
const { verifyAccount, discoverZones, deployMappingsForZone, listDNSRecords, listTunnelsForAccount, getAccountIdFromZone } = require('./cloudflare');

const app = express();
app.use(cors());
app.use(express.json());

function loadEnv() {
  const envPath = path.join(process.env.HOME, '.cloudflare-router', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const [key, ...val] = line.split('=');
      if (key && val.length) process.env[key.trim()] = val.join('=').trim();
    }
  }
}
loadEnv();

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

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
  try {
    removeAccount(req.params.id);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/accounts/:id/verify', async (req, res) => {
  try {
    const result = await verifyAccount(req.params.id);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/accounts/:id/discover', async (req, res) => {
  try {
    const zones = await discoverZones(req.params.id);
    res.json(zones);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/accounts/:id/zones', (req, res) => {
  try {
    const { zone_id, domain, tunnel_id, tunnel_credentials } = req.body;
    const zones = addZoneToAccount(req.params.id, zone_id, domain, tunnel_id, tunnel_credentials);
    res.json({ success: true, zones });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/accounts/:id/zones/:zoneId', (req, res) => {
  try {
    removeZoneFromAccount(req.params.id, req.params.zoneId);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/accounts/:id/zones/:zoneId/dns', async (req, res) => {
  try {
    const records = await listDNSRecords(req.params.id, req.params.zoneId);
    res.json(records);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/accounts/:id/tunnels', async (req, res) => {
  try {
    const tunnels = await listTunnelsForAccount(req.params.id);
    res.json(tunnels);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/dns/all', async (req, res) => {
  try {
    const config = loadConfig();
    const allDNS = [];
    for (const account of config.accounts || []) {
      for (const zone of account.zones || []) {
        try {
          const records = await listDNSRecords(account.id, zone.zone_id);
          records.forEach(r => {
            allDNS.push({ ...r, account_name: account.name, account_id: account.id, zone_domain: zone.domain });
          });
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
        tunnels.forEach(t => {
          allTunnels.push({ ...t, account_name: account.name, account_id: account.id });
        });
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
    if (!account_id || !zone_id || !subdomain || !port) {
      return res.status(400).json({ error: 'account_id, zone_id, subdomain, port required' });
    }
    const mappings = addMapping(account_id, zone_id, subdomain, port, description || '');
    res.json({ success: true, mappings });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/mappings/:account/:zone/:subdomain', (req, res) => {
  try {
    removeMapping(req.params.account, req.params.zone, req.params.subdomain);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/mappings/:account/:zone/:subdomain', (req, res) => {
  try {
    toggleMapping(req.params.account, req.params.zone, req.params.subdomain, req.body.enabled);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/generate', (req, res) => {
  try {
    const result = generateAllNginxConfigs();
    res.json({ success: true, ...result });
  } catch (error) { res.status(500).json({ error: error.message }); }
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

app.use('/', express.static(path.join(__dirname, 'dashboard')));

function startServer(port = 7070) {
  return new Promise((resolve) => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`Dashboard: http://localhost:${port}`);
      console.log(`API: http://localhost:${port}/api`);
      if (DASHBOARD_PASSWORD) console.log(`Auth: Password protected`);
      resolve();
    });
  });
}

module.exports = { app, startServer };
