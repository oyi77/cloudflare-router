const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadConfig, getConfigDir, getAllMappings } = require('./config');
const { generateFromTemplate } = require('./templates');
const { logAudit } = require('./audit');

function generateNginxConfig(mapping, listenPort) {
  // Use template system if template is set; otherwise use default
  return generateFromTemplate(mapping, listenPort);
}

function generateAllNginxConfigs() {
  const config = loadConfig();
  const mappings = getAllMappings();
  const sitesDir = config.nginx.config_dir;

  if (!fs.existsSync(sitesDir)) fs.mkdirSync(sitesDir, { recursive: true });

  // Auto-backup before generate if auto_backup enabled (default: true)
  if (config.server?.auto_backup !== false) {
    try {
      const { createAutoBackup } = require('./backup');
      createAutoBackup();
    } catch (e) { /* ignore backup errors */ }
  }

  const generated = [];
  mappings.filter(m => m.enabled !== false).forEach(mapping => {
    const nginxConfig = generateNginxConfig(mapping, config.nginx.listen_port);
    const filename = `${mapping.account_id}_${mapping.zone_id}_${mapping.subdomain || 'root'}.conf`;
    const filepath = path.join(sitesDir, filename);
    fs.writeFileSync(filepath, nginxConfig);
    generated.push({ file: filepath, domain: mapping.full_domain, account: mapping.account_name, template: mapping.template || 'default' });
  });

  const existingFiles = fs.readdirSync(sitesDir).filter(f => f.endsWith('.conf'));
  const generatedFilenames = generated.map(g => path.basename(g.file));

  existingFiles.forEach(file => {
    if (!generatedFilenames.includes(file)) {
      fs.unlinkSync(path.join(sitesDir, file));
    }
  });

  const includes = generated.map(g => `    include ${g.file};`).join('\n');
  const mainConfig = `events { worker_connections 1024; }
http {
    sendfile on; tcp_nopush on; tcp_nodelay on; keepalive_timeout 65;
    access_log /var/log/nginx/cloudflare-router-access.log;
    error_log /var/log/nginx/cloudflare-router-error.log;
    gzip on; gzip_vary on; gzip_proxied any; gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml;
${includes}
}
`;
  fs.writeFileSync(path.join(getConfigDir(), 'nginx', 'nginx.conf'), mainConfig);

  logAudit('generate', { total: generated.length, user: 'system' });

  return { site_configs: generated, total: generated.length };
}

function reloadNginx(configPath) {
  try {
    execSync(`nginx -t -c ${configPath}`, { stdio: 'pipe' });
    execSync(`nginx -s reload -c ${configPath}`, { stdio: 'pipe' });
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

function getNginxStatus() {
  try {
    const output = execSync('ps aux | grep nginx | grep -v grep', { encoding: 'utf8' });
    return { running: true, processes: output.trim().split('\n').length };
  } catch { return { running: false, processes: 0 }; }
}

module.exports = { generateNginxConfig, generateAllNginxConfigs, reloadNginx, getNginxStatus };
