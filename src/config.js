const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_DIR = path.join(process.env.HOME, '.cloudflare-router');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yml');
const MAPPINGS_FILE = path.join(CONFIG_DIR, 'mappings.yml');

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const nginxDir = path.join(CONFIG_DIR, 'nginx', 'sites');
  if (!fs.existsSync(nginxDir)) {
    fs.mkdirSync(nginxDir, { recursive: true });
  }
  const tunnelDir = path.join(CONFIG_DIR, 'tunnel');
  if (!fs.existsSync(tunnelDir)) {
    fs.mkdirSync(tunnelDir, { recursive: true });
  }
}

function loadConfig() {
  ensureDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return {
      cloudflare: {
        api_token: '',
        zone_id: '',
        tunnel_id: '',
        tunnel_credentials: '',
        domain: ''
      },
      nginx: {
        listen_port: 6969,
        config_dir: path.join(CONFIG_DIR, 'nginx', 'sites')
      },
      server: {
        port: 7070,
        host: '0.0.0.0'
      }
    };
  }
  return yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

function saveConfig(config) {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, yaml.dump(config, { indent: 2 }));
}

function loadMappings() {
  ensureDir();
  if (!fs.existsSync(MAPPINGS_FILE)) {
    return { mappings: [] };
  }
  return yaml.load(fs.readFileSync(MAPPINGS_FILE, 'utf8')) || { mappings: [] };
}

function saveMappings(data) {
  ensureDir();
  fs.writeFileSync(MAPPINGS_FILE, yaml.dump(data, { indent: 2 }));
}

function addMapping(subdomain, port, description = '', protocol = 'http') {
  const data = loadMappings();
  const existing = data.mappings.find(m => m.subdomain === subdomain);
  if (existing) {
    existing.port = port;
    existing.description = description;
    existing.protocol = protocol;
    existing.updated_at = new Date().toISOString();
  } else {
    data.mappings.push({
      subdomain,
      port: parseInt(port),
      description,
      protocol,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      enabled: true
    });
  }
  saveMappings(data);
  return data.mappings;
}

function removeMapping(subdomain) {
  const data = loadMappings();
  data.mappings = data.mappings.filter(m => m.subdomain !== subdomain);
  saveMappings(data);
  return data.mappings;
}

function toggleMapping(subdomain, enabled) {
  const data = loadMappings();
  const mapping = data.mappings.find(m => m.subdomain === subdomain);
  if (mapping) {
    mapping.enabled = enabled;
    mapping.updated_at = new Date().toISOString();
  }
  saveMappings(data);
  return data.mappings;
}

function getConfigDir() {
  return CONFIG_DIR;
}

module.exports = {
  loadConfig,
  saveConfig,
  loadMappings,
  saveMappings,
  addMapping,
  removeMapping,
  toggleMapping,
  getConfigDir,
  CONFIG_DIR,
  CONFIG_FILE,
  MAPPINGS_FILE
};
