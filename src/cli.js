#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const { loadConfig, saveConfig, addAccount, removeAccount, addZoneToAccount, removeZoneFromAccount, addMapping, removeMapping, toggleMapping, getAllMappings, getConfigDir } = require('./config');
const { generateAllNginxConfigs, getNginxStatus } = require('./nginx');
const { verifyAccount, discoverZones, deployMappingsForZone, listDNSRecords } = require('./cloudflare');
const { startServer } = require('./server');
const { startMCPServer } = require('./mcp');
const portless = require('./portless');
const { logAudit, readAudit, auditStats } = require('./audit');
const { discoverPorts, getUnmappedCandidates } = require('./discovery');
const { listTemplates } = require('./templates');
const { createAutoBackup, rollback, listRecentBackups } = require('./backup');
const { notify } = require('./notifier');

const program = new Command();
program.name('cloudflare-router').description('Manage Cloudflare Tunnels, nginx, and DNS from one place').version('1.2.0');

program.command('account:add').description('Add a Cloudflare account')
  .requiredOption('--name <name>', 'Account name (e.g., Personal, Work)')
  .requiredOption('--email <email>', 'Cloudflare account email')
  .requiredOption('--api-key <key>', 'Cloudflare Global API Key or API Token')
  .action(async (opts) => {
    const accounts = addAccount(opts.name, opts.email, opts.apiKey);
    console.log(chalk.green(`✓ Account "${opts.name}" added`));
    const result = await verifyAccount(accounts[accounts.length - 1].id);
    console.log(result.valid ? chalk.green(`✓ Verified (${result.zones_count} zones)`) : chalk.red(`✗ ${result.error}`));
  });

program.command('account:remove').description('Remove a Cloudflare account')
  .requiredOption('--id <id>', 'Account ID')
  .action((opts) => {
    removeAccount(opts.id);
    console.log(chalk.green('✓ Account removed'));
  });

program.command('account:list').description('List all Cloudflare accounts')
  .action(async () => {
    const config = loadConfig();
    if (!config.accounts?.length) { console.log(chalk.yellow('No accounts configured')); return; }
    console.log(chalk.bold('\nCloudflare Accounts:'));
    console.log(chalk.gray('─'.repeat(60)));
    for (const acc of config.accounts) {
      const result = await verifyAccount(acc.id);
      const status = result.valid ? chalk.green('●') : chalk.red('○');
      const zones = (acc.zones || []).length;
      console.log(`${status} ${chalk.cyan(acc.name.padEnd(20))} ${acc.email.padEnd(30)} ${zones} zones`);
    }
    console.log(chalk.gray('─'.repeat(60)));
  });

program.command('zone:discover').description('Discover zones for an account')
  .requiredOption('--account <id>', 'Account ID')
  .action(async (opts) => {
    const zones = await discoverZones(opts.account);
    console.log(chalk.bold('\nDiscovered Zones:'));
    console.log(chalk.gray('─'.repeat(60)));
    zones.forEach(z => {
      console.log(`${chalk.cyan(z.domain.padEnd(30))} ${z.zone_id} (${z.status})`);
    });
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray(`Found ${zones.length} zones`));
  });

program.command('zone:add').description('Add a zone to an account')
  .requiredOption('--account <id>', 'Account ID')
  .requiredOption('--zone-id <id>', 'Zone ID')
  .requiredOption('--domain <domain>', 'Domain name')
  .option('--tunnel-id <id>', 'Tunnel ID')
  .option('--credentials <path>', 'Tunnel credentials path')
  .action((opts) => {
    const zones = addZoneToAccount(opts.account, opts.zoneId, opts.domain, opts.tunnelId, opts.credentials);
    console.log(chalk.green(`✓ Zone "${opts.domain}" added`));
  });

program.command('zone:remove').description('Remove a zone from an account')
  .requiredOption('--account <id>', 'Account ID')
  .requiredOption('--zone-id <id>', 'Zone ID')
  .action((opts) => {
    removeZoneFromAccount(opts.account, opts.zoneId);
    console.log(chalk.green('✓ Zone removed'));
  });

program.command('add').description('Add a subdomain mapping')
  .option('--account <id>', 'Account ID (auto-detected if only one account)')
  .option('--zone <id>', 'Zone ID (auto-detected if only one zone)')
  .requiredOption('--subdomain <name>', 'Subdomain name')
  .requiredOption('--port <port>', 'Local port')
  .option('-d, --description <desc>', 'Description')
  .option('--template <name>', 'Nginx template: default|nextjs|api|websocket|grpc|static|largefiles', 'default')
  .option('--nginx-extra <directives>', 'Extra nginx directives to inject')
  .option('--auto-deploy', 'Auto generate+deploy after adding')
  .action(async (opts) => {
    const config = loadConfig();
    // Auto-detect account/zone if not provided and only one exists
    let accountId = opts.account;
    let zoneId = opts.zone;
    if (!accountId && config.accounts?.length === 1) accountId = config.accounts[0].id;
    if (!zoneId && config.accounts?.length === 1 && config.accounts[0].zones?.length === 1) {
      zoneId = config.accounts[0].zones[0].zone_id;
    }
    if (!accountId || !zoneId) {
      console.error(chalk.red('✗ --account and --zone are required (or configure a single account/zone)'));
      process.exit(1);
    }
    const before = null;
    const mappings = addMapping(accountId, zoneId, opts.subdomain, parseInt(opts.port), opts.description || '', 'http', {
      template: opts.template || 'default',
      nginx_extra: opts.nginxExtra,
    });
    const added = mappings.find(m => m.subdomain === opts.subdomain);
    logAudit('mapping_added', { subdomain: opts.subdomain, port: parseInt(opts.port), description: opts.description, template: opts.template, user: 'cli', before, after: added });
    notify('mapping_added', { subdomain: opts.subdomain, port: parseInt(opts.port), description: opts.description });
    console.log(chalk.green(`✓ ${opts.subdomain} → localhost:${opts.port}`) + (opts.template && opts.template !== 'default' ? chalk.gray(` [${opts.template}]`) : ''));

    const autoDeploy = opts.autoDeploy || config.server?.auto_deploy;
    if (autoDeploy) {
      console.log(chalk.blue('  Auto-deploying...'));
      generateAllNginxConfigs();
      console.log(chalk.green('  ✓ nginx configs generated'));
      const { syncZoneCloudflare } = require('./cloudflare');
      for (const account of config.accounts || []) {
        for (const zone of account.zones || []) {
          const { loadMappings } = require('./config');
          const { mappings: zm } = loadMappings(account.id, zone.zone_id);
          const results = await deployMappingsForZone(account.id, zone.zone_id, zone.domain, zone.tunnel_id, zm);
          const created = results.filter(r => r.status === 'created').length;
          console.log(chalk.green(`  ✓ DNS deployed (${created} new records)`));
          // Sync tunnel ingress so cloudflared picks it up immediately
          await syncZoneCloudflare(account.id, zone.zone_id).catch(() => {});
          console.log(chalk.green('  ✓ Tunnel ingress synced to Cloudflare'));
          notify('deploy_success', { count: created });
        }
      }
    }
  });

program.command('remove').description('Remove a mapping')
  .requiredOption('--account <id>', 'Account ID')
  .requiredOption('--zone <id>', 'Zone ID')
  .requiredOption('--subdomain <name>', 'Subdomain name')
  .action((opts) => {
    removeMapping(opts.account, opts.zone, opts.subdomain);
    console.log(chalk.green(`✓ Removed ${opts.subdomain}`));
  });

program.command('list').description('List all mappings')
  .action(() => {
    const mappings = getAllMappings();
    if (!mappings.length) { console.log(chalk.yellow('No mappings configured')); return; }
    console.log(chalk.bold('\nAll Subdomain Mappings:'));
    console.log(chalk.gray('─'.repeat(80)));
    mappings.forEach(m => {
      const status = m.enabled !== false ? chalk.green('●') : chalk.red('○');
      const desc = m.description ? chalk.gray(` (${m.description})`) : '';
      console.log(`${status} ${chalk.cyan(m.full_domain.padEnd(40))} → localhost:${m.port} ${chalk.gray(`[${m.account_name}]`)}${desc}`);
    });
    console.log(chalk.gray('─'.repeat(80)));
    console.log(chalk.gray(`Total: ${mappings.length} mappings`));
  });

program.command('generate').description('Generate nginx configs')
  .action(() => {
    const result = generateAllNginxConfigs();
    console.log(chalk.green(`✓ Generated ${result.total} nginx configs`));
    result.site_configs.forEach(c => {
      console.log(chalk.gray(`  ${c.account}: ${c.domain}`));
    });
  });

program.command('deploy').description('Deploy DNS records')
  .action(async () => {
    const config = loadConfig();
    for (const account of config.accounts || []) {
      for (const zone of account.zones || []) {
        const { loadMappings } = require('./config');
        const { mappings } = loadMappings(account.id, zone.zone_id);
        console.log(chalk.blue(`Deploying ${account.name}/${zone.domain}...`));
        const results = await deployMappingsForZone(account.id, zone.zone_id, zone.domain, zone.tunnel_id, mappings);
        results.forEach(r => {
          const icon = r.status === 'created' ? chalk.green('✓') : r.status === 'exists' ? chalk.yellow('•') : chalk.red('✗');
          console.log(`  ${icon} ${r.subdomain}: ${r.status}`);
        });
      }
    }
  });

program.command('status').description('Show status')
  .option('--watch', 'Live monitor mode (refresh every N seconds)')
  .option('--interval <sec>', 'Refresh interval in seconds for --watch', '5')
  .action(async (opts) => {
    const http = require('http');
    const fs = require('fs');
    const path = require('path');

    async function pingService(port, healthPath = '/cf-health') {
      return new Promise((resolve) => {
        const start = Date.now();
        const req = http.get({ hostname: '127.0.0.1', port, path: healthPath, timeout: 2000 }, (res) => {
          res.resume();
          resolve({ up: res.statusCode < 500, latency: Date.now() - start, status: res.statusCode });
        });
        req.on('error', () => resolve({ up: false, latency: null, status: null }));
        req.on('timeout', () => { req.destroy(); resolve({ up: false, latency: null, status: null }); });
      });
    }

    async function renderStatus() {
      const config = loadConfig();
      const mappings = getAllMappings();
      const nginx = getNginxStatus();

      if (opts.watch) process.stdout.write('\x1Bc'); // clear screen

      const now = new Date().toLocaleString('en-US', { hour12: false });
      const width = 64;
      const border = '═'.repeat(width);
      const titlePad = Math.floor((width - 38) / 2);
      console.log(chalk.cyan(`╔${border}╗`));
      console.log(chalk.cyan(`║`) + ' '.repeat(titlePad) + chalk.bold.white(`CF-Router Live Monitor`) + chalk.gray(`  [${now}]`) + ' '.repeat(Math.max(0, width - titlePad - 21 - now.length - 4)) + chalk.cyan(`║`));
      console.log(chalk.cyan(`╠${border}╣`));

      const nginxStr = nginx.running ? chalk.green(`✅ Running (${nginx.processes} workers)`) : chalk.red('❌ Stopped');
      console.log(chalk.cyan(`║`) + `  Nginx: ${nginxStr}` + ' '.repeat(Math.max(0, width - 10 - (nginx.running ? 18 + String(nginx.processes).length : 10))) + chalk.cyan(`║`));
      console.log(chalk.cyan(`║`) + `  Mappings: ${chalk.cyan(mappings.length)} active  Accounts: ${chalk.cyan(config.accounts?.length || 0)}` + ' '.repeat(10) + chalk.cyan(`║`));
      console.log(chalk.cyan(`╠${border}╣`));
      console.log(chalk.cyan(`║`) + chalk.bold(`  ${'SERVICE'.padEnd(22)} ${'PORT'.padEnd(7)} ${'STATUS'.padEnd(12)} LATENCY`) + ' '.repeat(4) + chalk.cyan(`║`));
      console.log(chalk.cyan(`╠${border}╣`));

      // Load apps.yaml health_check paths
      let appsConfig = {};
      try {
        const yaml = require('js-yaml');
        const appsFile = path.join(require('./config').CONFIG_DIR, 'apps.yaml');
        if (fs.existsSync(appsFile)) {
          const parsed = yaml.load(fs.readFileSync(appsFile, 'utf8'));
          appsConfig = parsed?.apps || {};
        }
      } catch {}

      // Deduplicate by port
      const seen = new Set();
      const unique = mappings.filter(m => {
        if (seen.has(m.port)) return false;
        seen.add(m.port);
        return true;
      }).slice(0, 20); // max 20 rows in watch mode

      for (const m of unique) {
        const appKey = m.subdomain;
        const healthPath = appsConfig[appKey]?.health_check || '/cf-health';
        const { up, latency } = opts.watch ? await pingService(m.port, healthPath) : { up: null, latency: null };
        const statusStr = up === null ? chalk.gray('--') : up ? chalk.green('🟢 UP') : chalk.red('🔴 DOWN');
        const latStr = latency ? chalk.yellow(`${latency}ms`) : chalk.gray('-');
        const name = (m.subdomain || 'root').slice(0, 20);
        console.log(chalk.cyan(`║`) + `  ${name.padEnd(22)} ${String(m.port).padEnd(7)} ${statusStr.padEnd(opts.watch ? 14 : 4)} ${latStr}` + ' '.repeat(2) + chalk.cyan(`║`));
      }

      console.log(chalk.cyan(`╠${border}╣`));
      const hint = opts.watch ? '  Press Ctrl+C to exit' : '  Use --watch for live monitoring';
      console.log(chalk.cyan(`║`) + chalk.gray(hint) + ' '.repeat(Math.max(0, width - hint.length)) + chalk.cyan(`║`));
      console.log(chalk.cyan(`╚${border}╝`));
    }

    if (opts.watch) {
      const interval = Math.max(2, parseInt(opts.interval) || 5) * 1000;
      await renderStatus();
      const timer = setInterval(renderStatus, interval);
      process.on('SIGINT', () => { clearInterval(timer); process.exit(0); });
    } else {
      await renderStatus();
    }
  });

program.command('dashboard').description('Start web dashboard')
  .option('-p, --port <port>', 'Port', '7070')
  .action(async (opts) => { await startServer(parseInt(opts.port)); });

program.command('mcp').description('Start MCP server for AI agent integration')
  .action(() => {
    console.error(chalk.cyan('Starting Cloudflare Router MCP Server...'));
    console.error(chalk.gray('Protocol: JSON-RPC 2.0 over stdio'));
    console.error(chalk.gray('Press Ctrl+C to stop'));
    startMCPServer();
  });

// ── Portless commands ─────────────────────────────────────────────────────────

program.command('port:register')
  .description('Register a service and allocate a port (portless mode)')
  .requiredOption('--service <name>', 'Service name (e.g., 1ai-backend)')
  .option('--subdomain <sub>', 'Subdomain to map this service to')
  .option('--account <id>', 'Cloudflare account ID (for auto-map)')
  .option('--zone <id>', 'Cloudflare zone ID (for auto-map)')
  .option('-d, --description <desc>', 'Service description')
  .option('--auto-map', 'Auto-add to cf-router mappings after registration')
  .action(async (opts) => {
    try {
      const port = await portless.registerService(opts.service, {
        subdomain: opts.subdomain,
        description: opts.description || '',
        account: opts.account,
        zone: opts.zone,
      });
      console.log(chalk.green(`✓ ${opts.service} → port ${port}`));

      // Auto-map to cf-router if flags provided
      if (opts.autoMap && opts.subdomain && opts.account && opts.zone) {
        addMapping(opts.account, opts.zone, opts.subdomain, port, opts.description || opts.service);
        const { generateAllNginxConfigs } = require('./nginx');
        generateAllNginxConfigs();
        console.log(chalk.green(`✓ Auto-mapped ${opts.subdomain}.* → localhost:${port} + nginx updated`));
      }

      // Output just the port number to stdout for shell capture:
      // PORT=$(cfr port:get myservice)
      process.stdout.write(`${port}\n`);
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

program.command('port:get')
  .description('Get the allocated port for a registered service')
  .argument('<service>', 'Service name')
  .option('--raw', 'Output port number only (for shell: PORT=$(cfr port:get svc))')
  .action((service, opts) => {
    const port = portless.getPort(service);
    if (port === null) {
      if (!opts.raw) console.error(chalk.red(`✗ Service not registered: ${service}`));
      process.exit(1);
    }
    if (opts.raw) {
      process.stdout.write(`${port}`);
    } else {
      console.log(chalk.cyan(`${service}`) + chalk.gray(' → ') + chalk.green(`port ${port}`));
    }
  });

program.command('port:list')
  .description('List all registered portless services')
  .action(() => {
    const services = portless.listServices();
    if (!services.length) {
      console.log(chalk.yellow('No portless services registered'));
      console.log(chalk.gray(`Register with: cfr port:register --service <name>`));
      return;
    }
    console.log(chalk.bold('\nPortless Services:'));
    console.log(chalk.gray('─'.repeat(70)));
    services.forEach(svc => {
      const sub = svc.subdomain ? chalk.gray(` → ${svc.subdomain}.*`) : '';
      const desc = svc.description ? chalk.gray(` (${svc.description})`) : '';
      console.log(`${chalk.green('●')} ${chalk.cyan(svc.name.padEnd(28))} port ${chalk.yellow(String(svc.port).padEnd(6))}${sub}${desc}`);
    });
    console.log(chalk.gray('─'.repeat(70)));
    console.log(chalk.gray(`Total: ${services.length} services | Range: ${portless.PORT_RANGE_START}-${portless.PORT_RANGE_END}`));
  });

program.command('port:release')
  .description('Release a service port registration')
  .argument('<service>', 'Service name')
  .action((service) => {
    try {
      const port = portless.releaseService(service);
      console.log(chalk.green(`✓ Released ${service} (port ${port})`));
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

program.command('port:env')
  .description('Output all portless ports as shell export statements')
  .option('--format <fmt>', 'Output format: shell (default), json, dotenv', 'shell')
  .action(() => {
    const env = portless.getEnvMap();
    const opts = program.opts();
    const fmt = (opts.format || 'shell');

    if (fmt === 'json') {
      console.log(JSON.stringify(env, null, 2));
    } else if (fmt === 'dotenv') {
      Object.entries(env).forEach(([k, v]) => console.log(`${k}=${v}`));
    } else {
      // shell — sourceable
      Object.entries(env).forEach(([k, v]) => console.log(`export ${k}=${v}`));
    }
  });

program.command('port:sync')
  .description('Sync portless services to cf-router mappings (register → nginx → DNS)')
  .requiredOption('--account <id>', 'Cloudflare account ID')
  .requiredOption('--zone <id>', 'Cloudflare zone ID')
  .action(async (opts) => {
    const services = portless.listServices().filter(s => s.subdomain && s.account === opts.account && s.zone === opts.zone);
    if (!services.length) {
      console.log(chalk.yellow('No portless services with subdomain+account+zone to sync'));
      return;
    }

    console.log(chalk.bold(`\nSyncing ${services.length} portless services...`));
    for (const svc of services) {
      addMapping(opts.account, opts.zone, svc.subdomain, svc.port, svc.description || svc.name);
      console.log(chalk.green(`  ✓ ${svc.subdomain} → port ${svc.port}`));
    }

    const { generateAllNginxConfigs } = require('./nginx');
    generateAllNginxConfigs();
    console.log(chalk.green(`✓ nginx configs regenerated`));

    console.log(chalk.blue('\nDeploying DNS...'));
    const { deployMappingsForZone } = require('./cloudflare');
    const { loadConfig, loadMappings } = require('./config');
    const config = loadConfig();
    const account = config.accounts.find(a => a.id === opts.account);
    const zone = account?.zones?.find(z => z.zone_id === opts.zone);
    if (zone) {
      const { mappings } = loadMappings(opts.account, opts.zone);
      const results = await deployMappingsForZone(opts.account, opts.zone, zone.domain, zone.tunnel_id, mappings);
      results.forEach(r => {
        const icon = r.status === 'created' ? chalk.green('✓') : chalk.yellow('•');
        console.log(`  ${icon} ${r.subdomain}: ${r.status}`);
      });
    }
    console.log(chalk.green('\n✓ Portless sync complete'));
  });

// ── Service Discovery ─────────────────────────────────────────────────────────

program.command('discover')
  .description('Scan listening ports and interactively assign subdomains to unmapped services')
  .option('--json', 'Output all ports as JSON (non-interactive)')
  .option('--all', 'Include already-mapped ports in output')
  .option('--auto-deploy', 'Auto generate+deploy after assignments')
  .action(async (opts) => {
    const ports = discoverPorts();

    if (opts.json) {
      console.log(JSON.stringify(opts.all ? ports : ports.filter(p => !p.mapped), null, 2));
      return;
    }

    console.log(chalk.bold('\nScanning listening ports...'));
    console.log(chalk.gray('─'.repeat(72)));
    console.log(chalk.bold(`${'PORT'.padEnd(8)}${'PROCESS'.padEnd(22)}MAPPED TO`));
    console.log(chalk.gray('─'.repeat(72)));

    for (const p of ports) {
      const portStr = chalk.cyan(String(p.port).padEnd(8));
      const procStr = p.process.padEnd(22);
      const mappedStr = p.mapped ? chalk.green(`✓ ${p.subdomain}`) : chalk.yellow('✗ unmapped');
      console.log(`${portStr}${procStr}${mappedStr}`);
    }
    console.log(chalk.gray('─'.repeat(72)));

    const candidates = ports.filter(p => !p.mapped && p.port > 1024 && ![22, 80, 443, 25, 53, 3306, 5432].includes(p.port));
    if (!candidates.length) {
      console.log(chalk.green('\n✓ All services are already mapped!'));
      return;
    }

    console.log(chalk.yellow(`\n${candidates.length} unmapped service(s) found.\n`));

    // Interactive prompts
    let { input } = require('@inquirer/prompts');
    if (!input) {
      const mod = require('@inquirer/prompts');
      input = mod.input || mod.default?.input;
    }
    const { confirm } = require('@inquirer/prompts');

    const config = loadConfig();
    let accountId = config.accounts?.[0]?.id;
    let zoneId = config.accounts?.[0]?.zones?.[0]?.zone_id;
    const assignments = [];

    for (const candidate of candidates) {
      let subdomain;
      try {
        subdomain = await input({
          message: `Subdomain for port ${chalk.cyan(candidate.port)} (${candidate.process})? [Enter to skip]`,
          default: '',
        });
      } catch { break; }

      if (!subdomain?.trim()) {
        console.log(chalk.gray(`  Skipped port ${candidate.port}`));
        continue;
      }
      assignments.push({ ...candidate, subdomain: subdomain.trim() });
    }

    if (!assignments.length) {
      console.log(chalk.yellow('No assignments made.'));
      return;
    }

    console.log(chalk.bold('\nSummary:'));
    assignments.forEach(a => console.log(`  ${chalk.green('+')} ${a.subdomain} → localhost:${a.port}`));

    let doIt;
    try {
      doIt = await confirm({ message: 'Apply these mappings?', default: true });
    } catch { doIt = true; }

    if (!doIt) { console.log(chalk.yellow('Aborted.')); return; }

    for (const a of assignments) {
      addMapping(accountId, zoneId, a.subdomain, a.port, a.process);
      logAudit('mapping_added', { subdomain: a.subdomain, port: a.port, user: 'cli:discover' });
      console.log(chalk.green(`  ✓ Added ${a.subdomain} → localhost:${a.port}`));
    }

    if (opts.autoDeploy || config.server?.auto_deploy) {
      generateAllNginxConfigs();
      console.log(chalk.green('✓ nginx configs generated'));
      for (const account of config.accounts || []) {
        for (const zone of account.zones || []) {
          const { loadMappings } = require('./config');
          const { mappings: zm } = loadMappings(account.id, zone.zone_id);
          await deployMappingsForZone(account.id, zone.zone_id, zone.domain, zone.tunnel_id, zm);
          console.log(chalk.green('✓ DNS deployed'));
        }
      }
    } else {
      console.log(chalk.blue('\nNext: run `cloudflare-router generate && cloudflare-router deploy`'));
    }
  });

// ── Templates ─────────────────────────────────────────────────────────────────

program.command('templates').description('List available nginx config templates')
  .action(() => {
    const templates = listTemplates();
    console.log(chalk.bold('\nAvailable Nginx Templates:'));
    console.log(chalk.gray('─'.repeat(60)));
    templates.forEach(t => {
      console.log(`  ${chalk.cyan(t.name.padEnd(15))} ${t.description}`);
    });
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray('Usage: cloudflare-router add --subdomain x --port 3000 --template nextjs'));
  });

// ── Rollback ──────────────────────────────────────────────────────────────────

program.command('rollback').description('Restore mappings from a previous backup')
  .option('--last', 'Restore most recent backup without prompt')
  .option('--file <filename>', 'Restore specific backup file')
  .option('--list', 'List available backups')
  .action(async (opts) => {
    if (opts.list) {
      const backups = listRecentBackups(20);
      if (!backups.length) { console.log(chalk.yellow('No backups found')); return; }
      console.log(chalk.bold('\nAvailable Backups:'));
      console.log(chalk.gray('─'.repeat(70)));
      backups.forEach((b, i) => {
        const typeStr = b.type === 'auto' ? chalk.gray('[auto]') : chalk.cyan('[manual]');
        console.log(`  ${String(i + 1).padEnd(4)}${b.file.padEnd(40)} ${typeStr} ${chalk.gray(b.created)}`);
      });
      return;
    }

    if (opts.last) {
      const result = rollback(null);
      logAudit('rollback', { file: result.file, user: 'cli' });
      console.log(chalk.green(`✓ Restored from ${result.file}`));
      console.log(chalk.blue('  Run `cloudflare-router generate` to apply changes'));
      return;
    }

    if (opts.file) {
      const result = rollback(opts.file);
      logAudit('rollback', { file: result.file, user: 'cli' });
      console.log(chalk.green(`✓ Restored from ${result.file}`));
      return;
    }

    // Interactive select
    const backups = listRecentBackups(10);
    if (!backups.length) { console.log(chalk.yellow('No backups found')); return; }

    console.log(chalk.bold('\nAvailable Backups (most recent first):'));
    backups.forEach((b, i) => {
      const typeStr = b.type === 'auto' ? '[auto]' : '[manual]';
      console.log(`  ${chalk.cyan(String(i + 1).padEnd(4))} ${b.file.padEnd(42)} ${chalk.gray(b.created)} ${typeStr}`);
    });

    let { input } = require('@inquirer/prompts');
    if (!input) input = require('@inquirer/prompts').default?.input;
    let choice;
    try {
      choice = await input({ message: 'Restore which backup? (number or filename, Enter to cancel)', default: '' });
    } catch { return; }

    if (!choice?.trim()) { console.log(chalk.yellow('Cancelled')); return; }

    let backupFile;
    const num = parseInt(choice.trim());
    if (!isNaN(num) && num >= 1 && num <= backups.length) {
      backupFile = backups[num - 1].file;
    } else {
      backupFile = choice.trim();
    }

    const result = rollback(backupFile);
    logAudit('rollback', { file: result.file, user: 'cli' });
    console.log(chalk.green(`✓ Restored from ${result.file}`));
    console.log(chalk.blue('  Run `cloudflare-router generate` to apply nginx changes'));
  });

// ── Audit Log ─────────────────────────────────────────────────────────────────

program.command('audit').description('View deployment audit log')
  .option('--limit <n>', 'Number of entries to show', '20')
  .option('--action <type>', 'Filter by action (mapping_added, deploy, generate, rollback, ...)')
  .option('--stats', 'Show summary statistics')
  .action((opts) => {
    if (opts.stats) {
      const stats = auditStats();
      console.log(chalk.bold('\nAudit Log Statistics:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Total entries:  ${chalk.cyan(stats.total)}`);
      console.log(`Today:          ${chalk.cyan(stats.today)}`);
      console.log(chalk.bold('\nBy action:'));
      Object.entries(stats.by_action).sort((a, b) => b[1] - a[1]).forEach(([action, count]) => {
        console.log(`  ${action.padEnd(25)} ${chalk.yellow(count)}`);
      });
      return;
    }

    const entries = readAudit({ limit: parseInt(opts.limit) || 20, action: opts.action });
    if (!entries.length) { console.log(chalk.yellow('No audit entries found')); return; }

    console.log(chalk.bold('\nAudit Log:'));
    console.log(chalk.gray('─'.repeat(80)));
    entries.forEach(e => {
      const ts = chalk.gray(e.ts?.slice(0, 19).replace('T', ' ') || '');
      const action = chalk.cyan(e.action?.padEnd(20) || '');
      const user = chalk.gray(`[${e.user || 'system'}]`);
      const detail = e.subdomain ? `${e.subdomain}${e.port ? `:${e.port}` : ''}` : (e.file || e.total || '');
      console.log(`${ts}  ${action}  ${user}  ${detail}`);
    });
    console.log(chalk.gray('─'.repeat(80)));
    console.log(chalk.gray(`Showing ${entries.length} entries`));
  });

// ── Interactive Wizard ────────────────────────────────────────────────────────

program.command('wizard').description('Interactive wizard to add a new service mapping')
  .action(async () => {
    const { input, select, confirm } = require('@inquirer/prompts');

    console.log(chalk.bold.cyan('\n🧙 CF-Router Wizard — Add New Service\n'));

    const config = loadConfig();
    if (!config.accounts?.length) {
      console.error(chalk.red('✗ No accounts configured. Run `cloudflare-router account:add` first.'));
      process.exit(1);
    }

    // Step 1: Scan ports
    console.log(chalk.gray('Scanning listening ports...'));
    const candidates = getUnmappedCandidates();
    const portChoices = candidates.map(p => ({
      name: `${p.port} — ${p.process}`,
      value: p.port,
    }));
    portChoices.push({ name: 'Enter port manually', value: 'manual' });

    let port;
    if (portChoices.length > 1) {
      try {
        const portChoice = await select({
          message: 'Select port to expose:',
          choices: portChoices,
        });
        if (portChoice === 'manual') {
          const manualPort = await input({ message: 'Enter port number:' });
          port = parseInt(manualPort);
        } else {
          port = portChoice;
        }
      } catch { process.exit(0); }
    } else {
      try {
        const manualPort = await input({ message: 'Enter port number (no unmapped ports detected):' });
        port = parseInt(manualPort);
      } catch { process.exit(0); }
    }

    if (!port || isNaN(port)) { console.error(chalk.red('✗ Invalid port')); process.exit(1); }

    // Step 2: Subdomain
    let subdomain;
    try {
      subdomain = await input({ message: 'Subdomain name (e.g. myapp):' });
    } catch { process.exit(0); }
    if (!subdomain?.trim()) { console.error(chalk.red('✗ Subdomain required')); process.exit(1); }

    // Step 3: Description
    let description = '';
    try {
      description = await input({ message: 'Description (optional):', default: '' });
    } catch {}

    // Step 4: Template
    const templateChoices = listTemplates().map(t => ({ name: `${t.name.padEnd(15)} — ${t.description}`, value: t.name }));
    let template = 'default';
    try {
      template = await select({ message: 'Nginx template:', choices: templateChoices });
    } catch {}

    // Step 5: Auto-deploy
    let autoDeploy = false;
    try {
      autoDeploy = await confirm({ message: 'Auto-deploy DNS now?', default: true });
    } catch {}

    // Step 6: Confirm
    const domain = config.accounts[0].zones[0].domain;
    console.log(chalk.bold('\nSummary:'));
    console.log(`  Subdomain:   ${chalk.cyan(subdomain.trim())}.${domain}`);
    console.log(`  Port:        ${chalk.cyan(port)}`);
    console.log(`  Description: ${description || chalk.gray('(none)')}`);
    console.log(`  Template:    ${chalk.cyan(template)}`);
    console.log(`  Auto-deploy: ${autoDeploy ? chalk.green('yes') : chalk.yellow('no')}`);

    let doIt;
    try {
      doIt = await confirm({ message: 'Apply?', default: true });
    } catch { doIt = false; }
    if (!doIt) { console.log(chalk.yellow('Cancelled.')); return; }

    // Execute
    const accountId = config.accounts[0].id;
    const zoneId = config.accounts[0].zones[0].zone_id;
    addMapping(accountId, zoneId, subdomain.trim(), port, description, 'http', { template });
    logAudit('mapping_added', { subdomain: subdomain.trim(), port, template, user: 'cli:wizard' });
    notify('mapping_added', { subdomain: subdomain.trim(), port, description });
    console.log(chalk.green(`\n✓ Added ${subdomain.trim()}.${domain} → localhost:${port}`));

    if (autoDeploy) {
      generateAllNginxConfigs();
      console.log(chalk.green('✓ nginx configs generated'));
      const { loadMappings } = require('./config');
      const { mappings: zm } = loadMappings(accountId, zoneId);
      const zone = config.accounts[0].zones[0];
      await deployMappingsForZone(accountId, zoneId, zone.domain, zone.tunnel_id, zm);
      console.log(chalk.green('✓ DNS deployed'));
      notify('deploy_success', { count: 1 });
    } else {
      console.log(chalk.blue('\nNext: run `cloudflare-router generate && cloudflare-router deploy`'));
    }

    console.log(chalk.bold.green('\n🎉 Done!'));
  });

// ── Portless enable/disable/test ──────────────────────────────────────────────

program.command('portless:enable <name>').description('Enable a portless service')
  .action((name) => {
    try {
      portless.enableService(name);
      console.log(chalk.green(`✓ Portless service "${name}" enabled`));
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

program.command('portless:disable <name>').description('Disable a portless service')
  .action((name) => {
    try {
      portless.disableService(name);
      console.log(chalk.green(`✓ Portless service "${name}" disabled`));
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

program.command('portless:test <name>').description('Run TCP+HTTP test on a portless service')
  .action(async (name) => {
    try {
      const result = await portless.testService(name);
      console.log(chalk.bold(`\nTest results for "${name}":`));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  TCP:  ${result.tcp?.open ? chalk.green(`✓ open (port ${result.tcp.port})`) : chalk.red('✗ closed')}`);
      console.log(`  HTTP: ${result.http?.ok ? chalk.green(`✓ ${result.http?.status} OK (${result.http?.latency}ms)`) : chalk.red('✗ unavailable')}`);
      console.log(chalk.gray('─'.repeat(50)));
      if (!result.tcp?.open && !result.http?.ok) process.exit(1);
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// ── App lifecycle commands ────────────────────────────────────────────────────

function appApiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const config = loadConfig();
    const port = process.env.PORT || config.server?.port || 7070;
    const token = process.env.AUTH_TOKEN || process.env.DASHBOARD_PASSWORD || '';
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

program.command('app:start <name>').description('Start an app process')
  .action(async (name) => {
    try {
      const res = await appApiRequest('POST', `/api/apps/${encodeURIComponent(name)}/start`);
      if (res.status !== 200) {
        console.error(chalk.red(`✗ ${res.body?.error || res.body}`));
        process.exit(1);
      }
      const pid = res.body?.pid;
      console.log(chalk.green(`✓ App "${name}" started`) + (pid ? chalk.gray(` (PID ${pid})`) : ''));
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

program.command('app:stop <name>').description('Stop an app process')
  .action(async (name) => {
    try {
      const res = await appApiRequest('POST', `/api/apps/${encodeURIComponent(name)}/stop`);
      if (res.status !== 200) {
        console.error(chalk.red(`✗ ${res.body?.error || res.body}`));
        process.exit(1);
      }
      console.log(chalk.green(`✓ App "${name}" stopped`));
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

program.command('app:restart <name>').description('Restart an app process')
  .action(async (name) => {
    try {
      const res = await appApiRequest('POST', `/api/apps/${encodeURIComponent(name)}/restart`);
      if (res.status !== 200) {
        console.error(chalk.red(`✗ ${res.body?.error || res.body}`));
        process.exit(1);
      }
      const pid = res.body?.pid;
      console.log(chalk.green(`✓ App "${name}" restarted`) + (pid ? chalk.gray(` (PID ${pid})`) : ''));
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

program.command('app:status <name>').description('Print app status, PID, autoStart, restartPolicy')
  .action(async (name) => {
    try {
      const res = await appApiRequest('GET', `/api/apps/${encodeURIComponent(name)}/status`);
      if (res.status !== 200) {
        console.error(chalk.red(`✗ ${res.body?.error || res.body}`));
        process.exit(1);
      }
      const s = res.body;
      console.log(chalk.bold(`\nApp: ${chalk.cyan(name)}`));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`  Status:        ${s.running ? chalk.green('running') : chalk.red('stopped')}`);
      if (s.pid)           console.log(`  PID:           ${chalk.yellow(s.pid)}`);
      if (s.autoStart !== undefined) console.log(`  Auto-start:    ${s.autoStart ? chalk.green('yes') : chalk.gray('no')}`);
      if (s.restartPolicy) console.log(`  Restart policy:${chalk.cyan(' ' + s.restartPolicy)}`);
      if (s.uptime)        console.log(`  Uptime:        ${chalk.gray(s.uptime)}`);
      console.log(chalk.gray('─'.repeat(40)));
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

program.command('app:logs <name>').description('Print app log lines')
  .option('--lines <n>', 'Number of lines to show', '50')
  .action(async (name, opts) => {
    try {
      const lines = parseInt(opts.lines) || 50;
      const res = await appApiRequest('GET', `/api/apps/${encodeURIComponent(name)}/logs?lines=${lines}`);
      if (res.status !== 200) {
        console.error(chalk.red(`✗ ${res.body?.error || res.body}`));
        process.exit(1);
      }
      const logs = res.body?.logs || res.body;
      if (Array.isArray(logs)) {
        logs.forEach(line => console.log(line));
      } else {
        console.log(logs);
      }
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

program.command('app:config <name>').description('Save app config (autoStart, restartPolicy)')
  .option('--auto-start <bool>', 'Enable auto-start (true/false)')
  .option('--restart-policy <value>', 'Restart policy (always|on-failure|never)')
  .action(async (name, opts) => {
    try {
      const patch = {};
      if (opts.autoStart !== undefined) patch.autoStart = opts.autoStart === 'true' || opts.autoStart === '1';
      if (opts.restartPolicy !== undefined) patch.restartPolicy = opts.restartPolicy;
      if (!Object.keys(patch).length) {
        console.error(chalk.red('✗ Provide --auto-start and/or --restart-policy'));
        process.exit(1);
      }
      const res = await appApiRequest('PATCH', `/api/apps/${encodeURIComponent(name)}/config`, patch);
      if (res.status !== 200) {
        console.error(chalk.red(`✗ ${res.body?.error || res.body}`));
        process.exit(1);
      }
      console.log(chalk.green(`✓ App "${name}" config updated`));
      if (patch.autoStart !== undefined)   console.log(chalk.gray(`  auto-start:     ${patch.autoStart}`));
      if (patch.restartPolicy !== undefined) console.log(chalk.gray(`  restart-policy: ${patch.restartPolicy}`));
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

program.command('app:test <name>').description('Run TCP+HTTP test on an app, print result')
  .action(async (name) => {
    try {
      // Get the app's port via status, then test TCP+HTTP directly
      const res = await appApiRequest('GET', `/api/apps/${encodeURIComponent(name)}/status`);
      if (res.status !== 200) {
        console.error(chalk.red(`✗ ${res.body?.error || res.body}`));
        process.exit(1);
      }
      const appPort = res.body?.port;
      if (!appPort) {
        console.error(chalk.red('✗ No port configured for this app'));
        process.exit(1);
      }

      const net = require('net');
      const http = require('http');

      // TCP test
      const tcpOk = await new Promise((resolve) => {
        const sock = net.createConnection({ host: '127.0.0.1', port: appPort });
        sock.once('connect', () => { sock.destroy(); resolve(true); });
        sock.once('error', () => resolve(false));
        setTimeout(() => { sock.destroy(); resolve(false); }, 2000);
      });

      // HTTP test
      let httpOk = false;
      let httpStatus = null;
      await new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${appPort}/`, (r) => {
          httpOk = true;
          httpStatus = r.statusCode;
          r.resume();
          resolve();
        });
        req.on('error', () => resolve());
        req.setTimeout(3000, () => { req.destroy(); resolve(); });
      });

      console.log(chalk.bold(`\nTest results for app "${name}" (port ${appPort}):`));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  TCP:  ${tcpOk  ? chalk.green('✓ open') : chalk.red('✗ closed')}`);
      console.log(`  HTTP: ${httpOk ? chalk.green(`✓ ${httpStatus}`) : chalk.red('✗ unreachable')}`);
      console.log(chalk.gray('─'.repeat(50)));
      if (!tcpOk && !httpOk) process.exit(1);
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

program.parse();
