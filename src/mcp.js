const { execSync } = require('child_process');
const net = require('net');
const { loadConfig, loadMappings, addMapping, removeMapping, toggleMapping, getAllMappings } = require('./config');
const { generateAllNginxConfigs, getNginxStatus } = require('./nginx');
const { generateTunnelConfig, getTunnelStatus } = require('./tunnel');
const { deployAllMappings, listDNSRecords, verifyToken } = require('./cloudflare');
const { discoverPorts, getUnmappedCandidates } = require('./discovery');
const { rollback, listRecentBackups } = require('./backup');
const { readAudit, auditStats } = require('./audit');
const { getNotifConfig, saveNotifConfig } = require('./notifier');
const { listServices, enableService, disableService, testService } = require('./portless');

const TOOLS = [
  {
    name: 'cloudflare_router_list_mappings',
    description: 'List all subdomain to port mappings in Cloudflare Router',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'cloudflare_router_add_mapping',
    description: 'Add or update a subdomain mapping in Cloudflare Router',
    inputSchema: {
      type: 'object',
      properties: {
        subdomain: { type: 'string', description: 'Subdomain name (e.g., api, www, admin)' },
        port: { type: 'number', description: 'Local port number to proxy to' },
        description: { type: 'string', description: 'Description of the service' }
      },
      required: ['subdomain', 'port']
    }
  },
  {
    name: 'cloudflare_router_remove_mapping',
    description: 'Remove a subdomain mapping from Cloudflare Router',
    inputSchema: {
      type: 'object',
      properties: {
        subdomain: { type: 'string', description: 'Subdomain name to remove' }
      },
      required: ['subdomain']
    }
  },
  {
    name: 'cloudflare_router_toggle_mapping',
    description: 'Enable or disable a subdomain mapping',
    inputSchema: {
      type: 'object',
      properties: {
        subdomain: { type: 'string', description: 'Subdomain name' },
        enabled: { type: 'boolean', description: 'Enable or disable the mapping' }
      },
      required: ['subdomain', 'enabled']
    }
  },
  {
    name: 'cloudflare_router_generate',
    description: 'Generate nginx and Cloudflare tunnel configs from current mappings',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'cloudflare_router_deploy',
    description: 'Deploy DNS records to Cloudflare for all enabled mappings',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'cloudflare_router_status',
    description: 'Get system status including nginx, tunnel, and mappings info',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'cloudflare_router_list_dns',
    description: 'List all Cloudflare DNS records for the configured zone',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'cloudflare_router_verify_token',
    description: 'Verify Cloudflare API token is valid',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'cloudflare_router_discover_ports',
    description: 'Scan localhost for listening ports and show which are already mapped to subdomains',
    inputSchema: { type: 'object', properties: { unmapped_only: { type: 'boolean', description: 'Return only unmapped ports' } }, required: [] }
  },
  {
    name: 'cloudflare_router_rollback',
    description: 'Restore CF-Router mappings from the most recent auto-backup',
    inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Specific backup filename (optional, defaults to most recent)' } }, required: [] }
  },
  {
    name: 'cloudflare_router_audit_log',
    description: 'Get recent deployment audit log entries',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max entries to return', default: 20 }, action: { type: 'string', description: 'Filter by action type' } }, required: [] }
  },
  {
    name: 'cloudflare_router_health_status',
    description: 'Ping all mapped services and return up/down status with latency for each',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'cloudflare_router_watch_status',
    description: 'Get a full snapshot: nginx status, tunnel status, and health of all services',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'cloudflare_router_configure_notifications',
    description: 'Configure Telegram or webhook notifications for CF-Router events',
    inputSchema: {
      type: 'object',
      properties: {
        telegram_enabled: { type: 'boolean' },
        telegram_bot_token: { type: 'string' },
        telegram_chat_id: { type: 'string' },
        webhook_enabled: { type: 'boolean' },
        webhook_url: { type: 'string' },
        webhook_events: { type: 'array', items: { type: 'string' } }
      },
      required: []
    }
  },
  {
    name: 'cloudflare_router_get_config',
    description: 'Get current Cloudflare Router configuration',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'cf_router_app_start',
    description: 'Start a managed app process by name',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'App name from apps.yaml' } }, required: ['name'] }
  },
  {
    name: 'cf_router_app_stop',
    description: 'Stop a running managed app process by name',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'App name' } }, required: ['name'] }
  },
  {
    name: 'cf_router_app_restart',
    description: 'Restart a managed app process (stop then start)',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'App name' } }, required: ['name'] }
  },
  {
    name: 'cf_router_app_status',
    description: 'Get status, PID, autoStart, and restartPolicy for a managed app',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'App name' } }, required: ['name'] }
  },
  {
    name: 'cf_router_app_logs',
    description: 'Get the last N log lines for a managed app',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'App name' }, lines: { type: 'number', description: 'Number of log lines to return (default 50)' } }, required: ['name'] }
  },
  {
    name: 'cf_router_app_config',
    description: 'Set autoStart and/or restartPolicy for a managed app',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'App name' }, autoStart: { type: 'boolean', description: 'Auto-start on server boot' }, restartPolicy: { type: 'string', enum: ['always', 'on-failure', 'never'], description: 'Restart policy' } }, required: ['name'] }
  },
  {
    name: 'cf_router_app_test',
    description: 'Run TCP and HTTP connectivity test on a managed app port',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'App name' } }, required: ['name'] }
  },
  {
    name: 'cf_router_portless_list',
    description: 'List all registered portless services with their ports and enabled status',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'cf_router_portless_enable',
    description: 'Enable a portless service by name',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Service name' } }, required: ['name'] }
  },
  {
    name: 'cf_router_portless_disable',
    description: 'Disable a portless service by name',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Service name' } }, required: ['name'] }
  },
  {
    name: 'cf_router_portless_test',
    description: 'Run TCP and HTTP connectivity test on a portless service port',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Service name' } }, required: ['name'] }
  }
];

async function handleToolCall(name, args) {
  switch (name) {
    case 'cloudflare_router_list_mappings': {
      const { mappings } = loadMappings();
      return { success: true, mappings };
    }

    case 'cloudflare_router_add_mapping': {
      const { subdomain, port, description } = args;
      if (!subdomain || !port) {
        return { success: false, error: 'subdomain and port are required' };
      }
      const mappings = addMapping(subdomain, port, description || '');
      return { success: true, message: `Mapping added: ${subdomain} → localhost:${port}`, mappings };
    }

    case 'cloudflare_router_remove_mapping': {
      const { subdomain } = args;
      if (!subdomain) {
        return { success: false, error: 'subdomain is required' };
      }
      const mappings = removeMapping(subdomain);
      return { success: true, message: `Mapping removed: ${subdomain}`, mappings };
    }

    case 'cloudflare_router_toggle_mapping': {
      const { subdomain, enabled } = args;
      if (!subdomain || enabled === undefined) {
        return { success: false, error: 'subdomain and enabled are required' };
      }
      const mappings = toggleMapping(subdomain, enabled);
      return { success: true, message: `Mapping ${enabled ? 'enabled' : 'disabled'}: ${subdomain}`, mappings };
    }

    case 'cloudflare_router_generate': {
      const nginxResult = generateAllNginxConfigs();
      const tunnelResult = generateTunnelConfig();
      return {
        success: true,
        nginx: nginxResult,
        tunnel: tunnelResult,
        message: `Generated ${nginxResult.total} nginx configs and tunnel config with ${tunnelResult.ingress_rules} ingress rules`
      };
    }

    case 'cloudflare_router_deploy': {
      try {
        const results = await deployAllMappings();
        return { success: true, results, message: `Deployed ${results.filter(r => r.status === 'created').length} DNS records` };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    case 'cloudflare_router_status': {
      const config = loadConfig();
      const { mappings } = loadMappings();
      const nginxStatus = getNginxStatus();
      const tunnelStatus = getTunnelStatus();
      return {
        success: true,
        nginx: nginxStatus,
        tunnel: tunnelStatus,
        mappings: {
          total: mappings.length,
          enabled: mappings.filter(m => m.enabled !== false).length,
          list: mappings
        },
        config: {
          domain: config.cloudflare?.domain,
          tunnel_id: config.cloudflare?.tunnel_id
        }
      };
    }

    case 'cloudflare_router_list_dns': {
      try {
        const records = await listDNSRecords();
        return { success: true, records };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    case 'cloudflare_router_verify_token': {
      try {
        const result = await verifyToken();
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    case 'cloudflare_router_discover_ports': {
      const ports = discoverPorts();
      const result = args.unmapped_only ? ports.filter(p => !p.mapped) : ports;
      return { content: [{ type: 'text', text: JSON.stringify({ ports: result, total: result.length, unmapped: result.filter(p => !p.mapped).length }, null, 2) }] };
    }

    case 'cloudflare_router_rollback': {
      const result = rollback(args.file || null);
      return { content: [{ type: 'text', text: `Restored from backup: ${result.file}\nTimestamp: ${result.timestamp}\nRun generate to apply nginx changes.` }] };
    }

    case 'cloudflare_router_audit_log': {
      const entries = readAudit({ limit: args.limit || 20, action: args.action || null });
      return { content: [{ type: 'text', text: JSON.stringify({ entries, stats: auditStats() }, null, 2) }] };
    }

    case 'cloudflare_router_health_status': {
      const mappings = getAllMappings();
      const seen = new Set();
      const unique = mappings.filter(m => { if (seen.has(m.port)) return false; seen.add(m.port); return true; });
      const results = await Promise.all(unique.map(m => new Promise(resolve => {
        const start = Date.now();
        const socket = new net.Socket();
        socket.setTimeout(2000);
        socket.connect(m.port, '127.0.0.1', () => { const lat = Date.now() - start; socket.destroy(); resolve({ subdomain: m.subdomain, port: m.port, up: true, latency: lat }); });
        socket.on('error', () => { socket.destroy(); resolve({ subdomain: m.subdomain, port: m.port, up: false, latency: null }); });
        socket.on('timeout', () => { socket.destroy(); resolve({ subdomain: m.subdomain, port: m.port, up: false, latency: null }); });
      })));
      const up = results.filter(r => r.up).length;
      return { content: [{ type: 'text', text: JSON.stringify({ services: results, summary: { total: results.length, up, down: results.length - up } }, null, 2) }] };
    }

    case 'cloudflare_router_watch_status': {
      const config = loadConfig();
      const mappings = getAllMappings();
      const nginx = getNginxStatus();
      const tunnel = getTunnelStatus();
      const seen = new Set();
      const unique = mappings.filter(m => { if (seen.has(m.port)) return false; seen.add(m.port); return true; }).slice(0, 30);
      const services = await Promise.all(unique.map(m => new Promise(resolve => {
        const start = Date.now();
        const socket = new net.Socket();
        socket.setTimeout(1500);
        socket.connect(m.port, '127.0.0.1', () => { socket.destroy(); resolve({ subdomain: m.subdomain, port: m.port, domain: m.full_domain, up: true, latency: Date.now() - start }); });
        socket.on('error', () => { socket.destroy(); resolve({ subdomain: m.subdomain, port: m.port, domain: m.full_domain, up: false, latency: null }); });
        socket.on('timeout', () => { socket.destroy(); resolve({ subdomain: m.subdomain, port: m.port, domain: m.full_domain, up: false, latency: null }); });
      })));
      return { content: [{ type: 'text', text: JSON.stringify({ nginx, tunnel, accounts: config.accounts?.length, mappings: mappings.length, services, checked_at: new Date().toISOString() }, null, 2) }] };
    }

    case 'cloudflare_router_configure_notifications': {
      const current = getNotifConfig();
      const updated = {
        telegram: {
          enabled: args.telegram_enabled ?? current.telegram?.enabled ?? false,
          bot_token: args.telegram_bot_token || current.telegram?.bot_token || '',
          chat_id: args.telegram_chat_id || current.telegram?.chat_id || '',
        },
        webhook: {
          enabled: args.webhook_enabled ?? current.webhook?.enabled ?? false,
          url: args.webhook_url || current.webhook?.url || '',
          events: args.webhook_events || current.webhook?.events || [],
        },
      };
      saveNotifConfig(updated);
      return { content: [{ type: 'text', text: `Notifications configured. Telegram: ${updated.telegram.enabled ? 'enabled' : 'disabled'}, Webhook: ${updated.webhook.enabled ? 'enabled' : 'disabled'}` }] };
    }

    case 'cloudflare_router_get_config': {
      const config = loadConfig();
      return {
        success: true,
        config: {
          ...config,
          cloudflare: {
            ...config.cloudflare,
            api_token: config.cloudflare.api_token ? '***' + config.cloudflare.api_token.slice(-4) : 'not set'
          }
        }
      };
    }

    case 'cf_router_app_start': {
      const { name } = args;
      if (!name) return { error: 'name is required', code: 'missing_param' };
      const yaml = require('js-yaml');
      const fs = require('fs');
      const path = require('path');
      const CONFIG_DIR = path.join(process.env.HOME, '.cloudflare-router');
      const APPS_YAML = path.join(CONFIG_DIR, 'apps.yaml');
      if (!fs.existsSync(APPS_YAML)) return { error: 'No apps configured', code: 'not_found' };
      const data = yaml.load(fs.readFileSync(APPS_YAML, 'utf8'));
      if (!data?.apps?.[name]) return { error: `App not found: ${name}`, code: 'not_found' };
      const { exec } = require('child_process');
      const appCfg = data.apps[name];
      const command = appCfg.command || appCfg.script || 'npm start';
      const cwd = appCfg.cwd || path.join(process.env.HOME, 'apps', name);
      return new Promise((resolve) => {
        const child = exec(command, { cwd, env: { ...process.env, ...appCfg.env } });
        resolve({ success: true, pid: child.pid, name, command });
      });
    }

    case 'cf_router_app_stop': {
      const { name } = args;
      if (!name) return { error: 'name is required', code: 'missing_param' };
      try {
        const { execSync } = require('child_process');
        execSync(`pkill -f "apps/${name}" 2>/dev/null || true`, { timeout: 3000 });
        return { success: true, name };
      } catch (e) {
        return { error: e.message, code: 'stop_failed' };
      }
    }

    case 'cf_router_app_restart': {
      const { name } = args;
      if (!name) return { error: 'name is required', code: 'missing_param' };
      try {
        const { execSync, exec } = require('child_process');
        const fs = require('fs');
        const path = require('path');
        const yaml = require('js-yaml');
        const CONFIG_DIR = path.join(process.env.HOME, '.cloudflare-router');
        const APPS_YAML = path.join(CONFIG_DIR, 'apps.yaml');
        execSync(`pkill -f "apps/${name}" 2>/dev/null || true`, { timeout: 3000 });
        await new Promise(r => setTimeout(r, 500));
        const data = yaml.load(fs.readFileSync(APPS_YAML, 'utf8'));
        const appCfg = data?.apps?.[name];
        if (!appCfg) return { error: `App not found: ${name}`, code: 'not_found' };
        const command = appCfg.command || appCfg.script || 'npm start';
        const cwd = appCfg.cwd || path.join(process.env.HOME, 'apps', name);
        const child = exec(command, { cwd, env: { ...process.env, ...appCfg.env } });
        return { success: true, pid: child.pid, name };
      } catch (e) {
        return { error: e.message, code: 'restart_failed' };
      }
    }

    case 'cf_router_app_status': {
      const { name } = args;
      if (!name) return { error: 'name is required', code: 'missing_param' };
      const fs = require('fs');
      const path = require('path');
      const yaml = require('js-yaml');
      const CONFIG_DIR = path.join(process.env.HOME, '.cloudflare-router');
      const APPS_YAML = path.join(CONFIG_DIR, 'apps.yaml');
      const data = fs.existsSync(APPS_YAML) ? yaml.load(fs.readFileSync(APPS_YAML, 'utf8')) : { apps: {} };
      const appCfg = data?.apps?.[name];
      if (!appCfg) return { error: `App not found: ${name}`, code: 'not_found' };
      return { success: true, name, autoStart: appCfg.autoStart || false, restartPolicy: appCfg.restartPolicy || 'never', config: appCfg };
    }

    case 'cf_router_app_logs': {
      const { name, lines = 50 } = args;
      if (!name) return { error: 'name is required', code: 'missing_param' };
      const fs = require('fs');
      const path = require('path');
      const CONFIG_DIR = path.join(process.env.HOME, '.cloudflare-router');
      const logFile = path.join(CONFIG_DIR, 'logs', `app-${name}.log`);
      if (!fs.existsSync(logFile)) return { success: true, logs: [], name };
      const logs = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-lines);
      return { success: true, name, logs };
    }

    case 'cf_router_app_config': {
      const { name, autoStart, restartPolicy } = args;
      if (!name) return { error: 'name is required', code: 'missing_param' };
      const fs = require('fs');
      const path = require('path');
      const yaml = require('js-yaml');
      const CONFIG_DIR = path.join(process.env.HOME, '.cloudflare-router');
      const APPS_YAML = path.join(CONFIG_DIR, 'apps.yaml');
      const data = fs.existsSync(APPS_YAML) ? yaml.load(fs.readFileSync(APPS_YAML, 'utf8')) : { apps: {} };
      if (!data?.apps?.[name]) return { error: `App not found: ${name}`, code: 'not_found' };
      if (autoStart !== undefined) data.apps[name].autoStart = autoStart;
      if (restartPolicy !== undefined) data.apps[name].restartPolicy = restartPolicy;
      fs.writeFileSync(APPS_YAML, yaml.dump(data, { lineWidth: -1 }));
      return { success: true, name, autoStart: data.apps[name].autoStart, restartPolicy: data.apps[name].restartPolicy };
    }

    case 'cf_router_app_test': {
      const { name } = args;
      if (!name) return { error: 'name is required', code: 'missing_param' };
      try {
        const result = await testService(name);
        return { success: true, name, ...result };
      } catch (e) {
        return { error: e.message, code: 'test_failed' };
      }
    }

    case 'cf_router_portless_list': {
      return { success: true, services: listServices() };
    }

    case 'cf_router_portless_enable': {
      const { name } = args;
      if (!name) return { error: 'name is required', code: 'missing_param' };
      try {
        const svc = enableService(name);
        return { success: true, name, enabled: svc.enabled };
      } catch (e) {
        return { error: e.message, code: 'enable_failed' };
      }
    }

    case 'cf_router_portless_disable': {
      const { name } = args;
      if (!name) return { error: 'name is required', code: 'missing_param' };
      try {
        const svc = disableService(name);
        return { success: true, name, enabled: svc.enabled };
      } catch (e) {
        return { error: e.message, code: 'disable_failed' };
      }
    }

    case 'cf_router_portless_test': {
      const { name } = args;
      if (!name) return { error: 'name is required', code: 'missing_param' };
      try {
        const result = await testService(name);
        return { success: true, name, ...result };
      } catch (e) {
        return { error: e.message, code: 'test_failed' };
      }
    }

    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

function startMCPServer() {
  const server = {
    tools: TOOLS,
    handleToolCall
  };

  process.stdin.setEncoding('utf8');
  let buffer = '';

  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const request = JSON.parse(line);
        const { method, params, id } = request;

        if (method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: { tools: TOOLS }
          }) + '\n');
        } else if (method === 'tools/call') {
          const result = await handleToolCall(params.name, params.arguments);
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id,
            result
          }) + '\n');
        } else if (method === 'initialize') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: {
                name: 'cloudflare-router',
                version: '1.0.0'
              }
            }
          }) + '\n');
        } else {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: 'Method not found' }
          }) + '\n');
        }
      } catch (e) {
        process.stderr.write(`Error: ${e.message}\n`);
      }
    }
  });

  process.stderr.write('Cloudflare Router MCP Server started\n');
}

module.exports = { TOOLS, handleToolCall, startMCPServer };
