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

  // Write flat includes file (no events/http blocks) so /etc/nginx/nginx.conf can safely include it
  const activeIncludes = generated.map(g => `include ${g.file};`).join('\n') + '\n';
  fs.writeFileSync(path.join(getConfigDir(), 'nginx', 'sites-active.conf'), activeIncludes);

  reloadNginx();
  logAudit('generate', { total: generated.length, user: 'system' });

  return { site_configs: generated, total: generated.length };
}

function reloadNginx() {
  try {
    execSync('sudo nginx -t', { stdio: 'pipe' });
    execSync('sudo nginx -s reload', { stdio: 'pipe' });
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
