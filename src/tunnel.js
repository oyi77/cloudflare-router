const fs = require('fs');
const path = require('path');
const { loadConfig, loadMappings, getConfigDir } = require('./config');
const { HTTP_MEDIUM_TIMEOUT_MS } = require('./constants');

function generateTunnelConfig() {
  const config = loadConfig();
  const { mappings } = loadMappings();

  const ingress = [];
  mappings.filter(m => m.enabled !== false).forEach(mapping => {
    const hostname = mapping.subdomain
      ? `${mapping.subdomain}.${config.cloudflare.domain}`
      : config.cloudflare.domain;

    ingress.push({
      hostname,
      service: `http://localhost:${config.nginx.listen_port}`
    });
  });

  ingress.push({ service: 'http_status:404' });

  const tunnelConfig = {
    tunnel: config.cloudflare.tunnel_id,
    'credentials-file': config.cloudflare.tunnel_credentials,
    'logfile': '/tmp/cloudflared-router.log',
    ingress
  };

  const configPath = path.join(getConfigDir(), 'tunnel', 'config.yml');
  fs.writeFileSync(configPath, require('js-yaml').dump(tunnelConfig, { indent: 2 }));

  return {
    config_path: configPath,
    ingress_rules: ingress.length - 1,
    domains: ingress.slice(0, -1).map(i => i.hostname)
  };
}

function getTunnelStatus() {
    try {
      const { execFileSync } = require('child_process');
      const { stdout } = execFileSync('ps', ['aux'], { encoding: 'utf8', timeout: HTTP_MEDIUM_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] });
     const cloudflaredLines = stdout.split('\n').filter(line => line.includes('cloudflared') && !line.includes('grep'));
     return { running: cloudflaredLines.length > 0, processes: cloudflaredLines.length };
   } catch {
     return { running: false, processes: 0 };
   }
 }

function startTunnel(configPath) {
   try {
     const { execFileSync } = require('child_process');
     execFileSync('cloudflared', ['tunnel', '--config', configPath, 'run'], { timeout: 5000, stdio: 'ignore', detached: true });
     return { success: true, message: 'Tunnel started' };
   } catch (error) {
     return { success: false, message: error.message };
   }
 }

module.exports = {
  generateTunnelConfig,
  getTunnelStatus,
  startTunnel
};
