const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadConfig, getConfigDir, getAllMappings } = require('./config');

function generateNginxConfig(mapping, listenPort) {
  return `server {
    listen ${listenPort};
    server_name ${mapping.full_domain};

    location / {
        proxy_pass http://127.0.0.1:${mapping.port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /cf-health {
        return 200 '{"status":"ok","service":"${mapping.subdomain}","domain":"${mapping.domain}"}';
        add_header Content-Type application/json;
    }
}
`;
}

function generateAllNginxConfigs() {
  const config = loadConfig();
  const mappings = getAllMappings();
  const sitesDir = config.nginx.config_dir;

  if (!fs.existsSync(sitesDir)) fs.mkdirSync(sitesDir, { recursive: true });

  const generated = [];
  mappings.filter(m => m.enabled !== false).forEach(mapping => {
    const nginxConfig = generateNginxConfig(mapping, config.nginx.listen_port);
    const filename = `${mapping.account_id}_${mapping.zone_id}_${mapping.subdomain || 'root'}.conf`;
    const filepath = path.join(sitesDir, filename);
    fs.writeFileSync(filepath, nginxConfig);
    generated.push({ file: filepath, domain: mapping.full_domain, account: mapping.account_name });
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
