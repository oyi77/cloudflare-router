const axios = require('axios');
const { loadConfig } = require('./config');

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

function getClientForAccount(accountId) {
  const config = loadConfig();
  const account = config.accounts.find(a => a.id === accountId);
  if (!account) throw new Error(`Account not found: ${accountId}`);

  const headers = { 'Content-Type': 'application/json' };
  if (account.api_token) {
    headers['Authorization'] = `Bearer ${account.api_token}`;
  } else if (account.email && account.api_key) {
    headers['X-Auth-Email'] = account.email;
    headers['X-Auth-Key'] = account.api_key;
  } else {
    throw new Error(`No credentials for account: ${account.name}`);
  }
  return axios.create({ baseURL: CF_API_BASE, headers });
}

function getClientForZone(accountId, zoneId) {
  return getClientForAccount(accountId);
}

async function listDNSRecords(accountId, zoneId) {
  const client = getClientForAccount(accountId);
  const response = await client.get(`/zones/${zoneId}/dns_records`);
  return response.data.result;
}

async function createDNSRecord(accountId, zoneId, subdomain, domain, tunnelId, type = 'CNAME', content = null) {
  const client = getClientForAccount(accountId);
  const name = subdomain ? `${subdomain}.${domain}` : domain;
  const target = content || `${tunnelId}.cfargotunnel.com`;

  const response = await client.post(`/zones/${zoneId}/dns_records`, {
    type, name, content: target, ttl: 1, proxied: true
  });
  return response.data.result;
}

async function deleteDNSRecord(accountId, zoneId, recordId) {
  const client = getClientForAccount(accountId);
  const response = await client.delete(`/zones/${zoneId}/dns_records/${recordId}`);
  return response.data.result;
}

async function getZoneInfo(accountId, zoneId) {
  const client = getClientForAccount(accountId);
  const response = await client.get(`/zones/${zoneId}`);
  return response.data.result;
}

async function listZonesForAccount(accountId) {
  const client = getClientForAccount(accountId);
  const response = await client.get('/zones');
  return response.data.result;
}

async function verifyAccount(accountId) {
  try {
    const client = getClientForAccount(accountId);
    const response = await client.get('/zones?per_page=1');
    return { valid: true, zones_count: response.data.result_info?.total_count || 0 };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

async function discoverZones(accountId) {
  try {
    const zones = await listZonesForAccount(accountId);
    return zones.map(z => ({
      zone_id: z.id,
      domain: z.name,
      status: z.status,
      plan: z.plan?.name || 'Free'
    }));
  } catch (error) {
    return [];
  }
}

async function deployMappingsForZone(accountId, zoneId, domain, tunnelId, mappings) {
  const results = [];
  for (const mapping of mappings.filter(m => m.enabled !== false)) {
    try {
      const records = await listDNSRecords(accountId, zoneId);
      const name = mapping.subdomain ? `${mapping.subdomain}.${domain}` : domain;
      const existing = records.find(r => r.name === name);

      if (existing) {
        results.push({ subdomain: mapping.subdomain, status: 'exists', record_id: existing.id });
      } else {
        const record = await createDNSRecord(accountId, zoneId, mapping.subdomain, domain, tunnelId);
        results.push({ subdomain: mapping.subdomain, status: 'created', record_id: record.id });
      }
    } catch (error) {
      results.push({ subdomain: mapping.subdomain, status: 'error', error: error.message });
    }
  }
  return results;
}

async function listTunnelsForAccount(accountId) {
  try {
    const config = loadConfig();
    const account = config.accounts.find(a => a.id === accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);

    const client = getClientForAccount(accountId);
    const accountIdCF = account.account_id || await getAccountIdFromZone(accountId);
    const response = await client.get(`/accounts/${accountIdCF}/cfd_tunnel`);
    return response.data.result.map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      created_at: t.created_at,
      tun_type: t.tun_type
    }));
  } catch (error) {
    return [];
  }
}

async function getAccountIdFromZone(accountId) {
  const config = loadConfig();
  const account = config.accounts.find(a => a.id === accountId);
  if (!account || !account.zones?.length) throw new Error('No zones configured');

  const client = getClientForAccount(accountId);
  const response = await client.get(`/zones/${account.zones[0].zone_id}`);
  return response.data.result.account.id;
}

module.exports = {
  getClientForAccount, getClientForZone,
  listDNSRecords, createDNSRecord, deleteDNSRecord,
  getZoneInfo, listZonesForAccount,
  verifyAccount, discoverZones,
  deployMappingsForZone,
  listTunnelsForAccount, getAccountIdFromZone
};
