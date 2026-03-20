const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { loadConfig, saveConfig, loadMappings, addMapping, removeMapping, toggleMapping } = require('./config');
const { generateAllNginxConfigs, getNginxStatus, reloadNginx } = require('./nginx');
const { generateTunnelConfig, getTunnelStatus } = require('./tunnel');
const { verifyToken, listDNSRecords, createDNSRecord, deleteDNSRecord, deployAllMappings } = require('./cloudflare');

const app = express();
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

const swaggerDoc = {
  openapi: '3.0.0',
  info: {
    title: 'Cloudflare Router API',
    version: '1.0.0',
    description: 'Manage Cloudflare Tunnels, nginx reverse proxies, and DNS records from one place.'
  },
  paths: {
    '/api/config': {
      get: {
        summary: 'Get current config',
        responses: {
          200: { description: 'Config object' }
        }
      },
      put: {
        summary: 'Update config',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object' }
            }
          }
        },
        responses: {
          200: { description: 'Updated config' }
        }
      }
    },
    '/api/mappings': {
      get: {
        summary: 'List all mappings',
        responses: {
          200: { description: 'Array of mappings' }
        }
      },
      post: {
        summary: 'Add or update mapping',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  subdomain: { type: 'string' },
                  port: { type: 'number' },
                  description: { type: 'string' }
                },
                required: ['subdomain', 'port']
              }
            }
          }
        },
        responses: {
          200: { description: 'Updated mappings list' }
        }
      }
    },
    '/api/mappings/{subdomain}': {
      delete: {
        summary: 'Remove mapping',
        parameters: [
          { name: 'subdomain', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          200: { description: 'Updated mappings list' }
        }
      },
      patch: {
        summary: 'Toggle mapping enabled/disabled',
        parameters: [
          { name: 'subdomain', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { enabled: { type: 'boolean' } }
              }
            }
          }
        },
        responses: {
          200: { description: 'Updated mappings list' }
        }
      }
    },
    '/api/generate/nginx': {
      post: {
        summary: 'Generate nginx configs',
        responses: {
          200: { description: 'Generation result' }
        }
      }
    },
    '/api/generate/tunnel': {
      post: {
        summary: 'Generate tunnel config',
        responses: {
          200: { description: 'Generation result' }
        }
      }
    },
    '/api/deploy': {
      post: {
        summary: 'Deploy all DNS records to Cloudflare',
        responses: {
          200: { description: 'Deployment results' }
        }
      }
    },
    '/api/status': {
      get: {
        summary: 'Get system status',
        responses: {
          200: { description: 'Status object with nginx, tunnel, and DNS info' }
        }
      }
    },
    '/api/dns': {
      get: {
        summary: 'List Cloudflare DNS records',
        responses: {
          200: { description: 'Array of DNS records' }
        }
      }
    },
    '/api/verify': {
      get: {
        summary: 'Verify Cloudflare API token',
        responses: {
          200: { description: 'Token verification result' }
        }
      }
    },
    '/api/full-deploy': {
      post: {
        summary: 'Full deploy: generate nginx + tunnel + DNS records',
        responses: {
          200: { description: 'Full deployment result' }
        }
      }
    }
  }
};

app.get('/api/docs/swagger.json', (req, res) => {
  res.json(swaggerDoc);
});

app.get('/api/config', (req, res) => {
  try {
    const config = loadConfig();
    const safeConfig = { ...config };
    if (safeConfig.cloudflare) {
      safeConfig.cloudflare = { ...safeConfig.cloudflare };
      if (safeConfig.cloudflare.api_token) {
        safeConfig.cloudflare.api_token_masked = safeConfig.cloudflare.api_token.substring(0, 8) + '...';
        delete safeConfig.cloudflare.api_token;
      }
    }
    res.json(safeConfig);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/config', (req, res) => {
  try {
    const currentConfig = loadConfig();
    const newConfig = { ...currentConfig, ...req.body };
    if (req.body.cloudflare) {
      newConfig.cloudflare = { ...currentConfig.cloudflare, ...req.body.cloudflare };
    }
    saveConfig(newConfig);
    res.json({ success: true, message: 'Config updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mappings', (req, res) => {
  try {
    const { mappings } = loadMappings();
    res.json(mappings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/mappings', (req, res) => {
  try {
    const { subdomain, port, description, protocol } = req.body;
    if (!subdomain || !port) {
      return res.status(400).json({ error: 'subdomain and port are required' });
    }
    const mappings = addMapping(subdomain, port, description || '', protocol || 'http');
    res.json({ success: true, mappings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/mappings/:subdomain', (req, res) => {
  try {
    const mappings = removeMapping(req.params.subdomain);
    res.json({ success: true, mappings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/mappings/:subdomain', (req, res) => {
  try {
    const { enabled } = req.body;
    const mappings = toggleMapping(req.params.subdomain, enabled);
    res.json({ success: true, mappings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/generate/nginx', (req, res) => {
  try {
    const result = generateAllNginxConfigs();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/generate/tunnel', (req, res) => {
  try {
    const result = generateTunnelConfig();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/deploy', async (req, res) => {
  try {
    const results = await deployAllMappings();
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/status', (req, res) => {
  try {
    const config = loadConfig();
    const { mappings } = loadMappings();
    const nginxStatus = getNginxStatus();
    const tunnelStatus = getTunnelStatus();

    res.json({
      nginx: nginxStatus,
      tunnel: tunnelStatus,
      mappings: {
        total: mappings.length,
        enabled: mappings.filter(m => m.enabled !== false).length
      },
      config: {
        domain: config.cloudflare?.domain || 'not configured',
        tunnel_id: config.cloudflare?.tunnel_id || 'not configured'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dns', async (req, res) => {
  try {
    const records = await listDNSRecords();
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/verify', async (req, res) => {
  try {
    const result = await verifyToken();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/full-deploy', async (req, res) => {
  try {
    const nginxResult = generateAllNginxConfigs();
    const tunnelResult = generateTunnelConfig();
    const dnsResults = await deployAllMappings();

    res.json({
      success: true,
      nginx: nginxResult,
      tunnel: tunnelResult,
      dns: dnsResults
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use('/', express.static(path.join(__dirname, 'dashboard')));

function startServer(port = 7070) {
  return new Promise((resolve) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`Cloudflare Router Dashboard: http://localhost:${port}`);
      console.log(`API Docs: http://localhost:${port}/api/docs`);
      resolve(server);
    });
  });
}

module.exports = { app, startServer };
