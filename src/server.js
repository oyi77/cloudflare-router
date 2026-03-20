const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { loadConfig, addAccount, removeAccount, addZoneToAccount, removeZoneFromAccount, addMapping, removeMapping, toggleMapping, getAllMappings, getConfigDir } = require('./config');
const { generateAllNginxConfigs, getNginxStatus } = require('./nginx');
const { verifyAccount, discoverZones, deployMappingsForZone, listDNSRecords } = require('./cloudflare');

const app = express();
app.use(cors());
app.use(express.json());

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
      resolve();
    });
  });
}

module.exports = { app, startServer };
