const fs = require('fs');
const path = require('path');
const { loadConfig, loadMappings, getConfigDir } = require('./config');

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
    const { execSync } = require('child_process');
    const output = execSync('ps aux | grep cloudflared | grep -v grep', { encoding: 'utf8' });
    return { running: true, processes: output.trim().split('\n').length };
  } catch {
    return { running: false, processes: 0 };
  }
}

function startTunnel(configPath) {
  try {
    const { execSync } = require('child_process');
    execSync(`cloudflared tunnel --config ${configPath} run &`, { stdio: 'pipe' });
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
