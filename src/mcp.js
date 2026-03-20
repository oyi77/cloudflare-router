const { execSync } = require('child_process');
const { loadConfig, loadMappings, addMapping, removeMapping, toggleMapping } = require('./config');
const { generateAllNginxConfigs, getNginxStatus } = require('./nginx');
const { generateTunnelConfig, getTunnelStatus } = require('./tunnel');
const { deployAllMappings, listDNSRecords, verifyToken } = require('./cloudflare');

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
    name: 'cloudflare_router_get_config',
    description: 'Get current Cloudflare Router configuration',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
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
