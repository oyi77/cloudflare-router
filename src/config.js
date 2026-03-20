const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_DIR = path.join(process.env.HOME, '.cloudflare-router');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yml');
const MAPPINGS_DIR = path.join(CONFIG_DIR, 'mappings');

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(MAPPINGS_DIR)) fs.mkdirSync(MAPPINGS_DIR, { recursive: true });
  if (!fs.existsSync(path.join(CONFIG_DIR, 'nginx', 'sites'))) {
    fs.mkdirSync(path.join(CONFIG_DIR, 'nginx', 'sites'), { recursive: true });
  }
  if (!fs.existsSync(path.join(CONFIG_DIR, 'tunnel'))) {
    fs.mkdirSync(path.join(CONFIG_DIR, 'tunnel'), { recursive: true });
  }
}

function loadConfig() {
  ensureDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return {
      accounts: [],
      nginx: { listen_port: 6969, config_dir: path.join(CONFIG_DIR, 'nginx', 'sites') },
      server: { port: 7070, host: '0.0.0.0' }
    };
  }
  return yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

function saveConfig(config) {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, yaml.dump(config, { indent: 2, lineWidth: 120 }));
}

function getAccountId(nameOrEmail) {
  const config = loadConfig();
  const account = config.accounts.find(a => a.name === nameOrEmail || a.email === nameOrEmail);
  return account ? account.id : null;
}

function addAccount(name, email, apiKey) {
  const config = loadConfig();
  const id = `cf_${Date.now()}`;
  config.accounts.push({ id, name, email, api_key: apiKey, zones: [] });
  saveConfig(config);
  return config.accounts;
}

function removeAccount(id) {
  const config = loadConfig();
  config.accounts = config.accounts.filter(a => a.id !== id);
  saveConfig(config);
  return config.accounts;
}

function addZoneToAccount(accountId, zoneId, domain, tunnelId, tunnelCredentials) {
  const config = loadConfig();
  const account = config.accounts.find(a => a.id === accountId);
  if (!account) throw new Error(`Account not found: ${accountId}`);
  if (!account.zones) account.zones = [];
  const existing = account.zones.find(z => z.zone_id === zoneId);
  if (existing) {
    existing.domain = domain;
    existing.tunnel_id = tunnelId;
    existing.tunnel_credentials = tunnelCredentials;
  } else {
    account.zones.push({ zone_id: zoneId, domain, tunnel_id: tunnelId, tunnel_credentials: tunnelCredentials, mappings: [] });
  }
  saveConfig(config);
  return account.zones;
}

function removeZoneFromAccount(accountId, zoneId) {
  const config = loadConfig();
  const account = config.accounts.find(a => a.id === accountId);
  if (!account) throw new Error(`Account not found: ${accountId}`);
  account.zones = (account.zones || []).filter(z => z.zone_id !== zoneId);
  saveConfig(config);
  return account.zones;
}

function getMappingFile(accountId, zoneId) {
  return path.join(MAPPINGS_DIR, `${accountId}_${zoneId}.yml`);
}

function loadMappings(accountId, zoneId) {
  ensureDir();
  const file = getMappingFile(accountId, zoneId);
  if (!fs.existsSync(file)) return { mappings: [] };
  return yaml.load(fs.readFileSync(file, 'utf8')) || { mappings: [] };
}

function saveMappings(accountId, zoneId, data) {
  ensureDir();
  fs.writeFileSync(getMappingFile(accountId, zoneId), yaml.dump(data, { indent: 2 }));
}

function addMapping(accountId, zoneId, subdomain, port, description = '', protocol = 'http') {
  const data = loadMappings(accountId, zoneId);
  const existing = data.mappings.find(m => m.subdomain === subdomain);
  if (existing) {
    existing.port = port;
    existing.description = description;
    existing.protocol = protocol;
    existing.updated_at = new Date().toISOString();
  } else {
    data.mappings.push({
      subdomain, port: parseInt(port), description, protocol,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), enabled: true
    });
  }
  saveMappings(accountId, zoneId, data);
  return data.mappings;
}

function removeMapping(accountId, zoneId, subdomain) {
  const data = loadMappings(accountId, zoneId);
  data.mappings = data.mappings.filter(m => m.subdomain !== subdomain);
  saveMappings(accountId, zoneId, data);
  return data.mappings;
}

function toggleMapping(accountId, zoneId, subdomain, enabled) {
  const data = loadMappings(accountId, zoneId);
  const mapping = data.mappings.find(m => m.subdomain === subdomain);
  if (mapping) {
    mapping.enabled = enabled;
    mapping.updated_at = new Date().toISOString();
  }
  saveMappings(accountId, zoneId, data);
  return data.mappings;
}

function getAllMappings() {
  const config = loadConfig();
  const all = [];
  for (const account of config.accounts || []) {
    for (const zone of account.zones || []) {
      const { mappings } = loadMappings(account.id, zone.zone_id);
      mappings.forEach(m => {
        all.push({
          ...m,
          account_id: account.id,
          account_name: account.name,
          zone_id: zone.zone_id,
          domain: zone.domain,
          full_domain: m.subdomain ? `${m.subdomain}.${zone.domain}` : zone.domain
        });
      });
    }
  }
  return all;
}

function getConfigDir() { return CONFIG_DIR; }

module.exports = {
  loadConfig, saveConfig, getConfigDir, CONFIG_DIR, CONFIG_FILE,
  getAccountId, addAccount, removeAccount,
  addZoneToAccount, removeZoneFromAccount,
  loadMappings, saveMappings, addMapping, removeMapping, toggleMapping, getAllMappings
};
