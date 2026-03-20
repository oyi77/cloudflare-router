const axios = require('axios');
const { loadConfig } = require('./config');

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

function getClient() {
  const config = loadConfig();
  if (!config.cloudflare.api_token) {
    throw new Error('Cloudflare API token not configured. Run: cloudflare-router init');
  }
  return axios.create({
    baseURL: CF_API_BASE,
    headers: {
      'Authorization': `Bearer ${config.cloudflare.api_token}`,
      'Content-Type': 'application/json'
    }
  });
}

async function listDNSRecords() {
  const config = loadConfig();
  const client = getClient();
  const response = await client.get(`/zones/${config.cloudflare.zone_id}/dns_records`);
  return response.data.result;
}

async function createDNSRecord(subdomain, type = 'CNAME', content = null) {
  const config = loadConfig();
  const client = getClient();
  const name = subdomain ? `${subdomain}.${config.cloudflare.domain}` : config.cloudflare.domain;
  const target = content || `${config.cloudflare.tunnel_id}.cfargotunnel.com`;

  const response = await client.post(`/zones/${config.cloudflare.zone_id}/dns_records`, {
    type,
    name,
    content: target,
    ttl: 1,
    proxied: true
  });
  return response.data.result;
}

async function deleteDNSRecord(recordId) {
  const config = loadConfig();
  const client = getClient();
  const response = await client.delete(`/zones/${config.cloudflare.zone_id}/dns_records/${recordId}`);
  return response.data.result;
}

async function updateDNSRecord(recordId, subdomain, type = 'CNAME', content = null) {
  const config = loadConfig();
  const client = getClient();
  const name = subdomain ? `${subdomain}.${config.cloudflare.domain}` : config.cloudflare.domain;
  const target = content || `${config.cloudflare.tunnel_id}.cfargotunnel.com`;

  const response = await client.put(`/zones/${config.cloudflare.zone_id}/dns_records/${recordId}`, {
    type,
    name,
    content: target,
    ttl: 1,
    proxied: true
  });
  return response.data.result;
}

async function getZoneInfo() {
  const config = loadConfig();
  const client = getClient();
  const response = await client.get(`/zones/${config.cloudflare.zone_id}`);
  return response.data.result;
}

async function getTunnelInfo() {
  const config = loadConfig();
  const client = getClient();
  const response = await client.get(`/accounts/${config.cloudflare.account_id}/cfd_tunnel/${config.cloudflare.tunnel_id}`);
  return response.data.result;
}

async function listTunnels() {
  const config = loadConfig();
  const client = getClient();
  const response = await client.get(`/accounts/${config.cloudflare.account_id}/cfd_tunnel`);
  return response.data.result;
}

async function verifyToken() {
  try {
    const client = getClient();
    const response = await client.get('/user/tokens/verify');
    return { valid: true, ...response.data.result };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

async function deployAllMappings() {
  const config = loadConfig();
  const { mappings } = require('./config').loadMappings();
  const results = [];

  for (const mapping of mappings.filter(m => m.enabled !== false)) {
    try {
      const records = await listDNSRecords();
      const existing = records.find(r => r.name === `${mapping.subdomain}.${config.cloudflare.domain}`);

      if (existing) {
        results.push({
          subdomain: mapping.subdomain,
          status: 'exists',
          record_id: existing.id
        });
      } else {
        const record = await createDNSRecord(mapping.subdomain);
        results.push({
          subdomain: mapping.subdomain,
          status: 'created',
          record_id: record.id
        });
      }
    } catch (error) {
      results.push({
        subdomain: mapping.subdomain,
        status: 'error',
        error: error.message
      });
    }
  }

  return results;
}

module.exports = {
  listDNSRecords,
  createDNSRecord,
  deleteDNSRecord,
  updateDNSRecord,
  getZoneInfo,
  getTunnelInfo,
  listTunnels,
  verifyToken,
  deployAllMappings
};
