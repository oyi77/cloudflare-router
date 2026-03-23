#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const { loadConfig, addAccount, removeAccount, addZoneToAccount, removeZoneFromAccount, addMapping, removeMapping, toggleMapping, getAllMappings, getConfigDir } = require('./config');
const { generateAllNginxConfigs, getNginxStatus } = require('./nginx');
const { verifyAccount, discoverZones, deployMappingsForZone, listDNSRecords } = require('./cloudflare');
const { startServer } = require('./server');
const { startMCPServer } = require('./mcp');
const portless = require('./portless');

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
  .requiredOption('--account <id>', 'Account ID')
  .requiredOption('--zone <id>', 'Zone ID')
  .requiredOption('--subdomain <name>', 'Subdomain name')
  .requiredOption('--port <port>', 'Local port')
  .option('-d, --description <desc>', 'Description')
  .action((opts) => {
    const mappings = addMapping(opts.account, opts.zone, opts.subdomain, parseInt(opts.port), opts.description || '');
    console.log(chalk.green(`✓ ${opts.subdomain} → localhost:${opts.port}`));
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
  .action(() => {
    const config = loadConfig();
    const mappings = getAllMappings();
    const nginx = getNginxStatus();
    console.log(chalk.bold('\nCloudflare Router Status:'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(`Accounts:  ${chalk.cyan(config.accounts?.length || 0)}`);
    console.log(`Zones:     ${chalk.cyan(config.accounts?.reduce((s, a) => s + (a.zones?.length || 0), 0) || 0)}`);
    console.log(`Mappings:  ${chalk.cyan(mappings.length)}`);
    console.log(`Nginx:     ${nginx.running ? chalk.green('Running') : chalk.red('Stopped')}`);
    console.log(chalk.gray('─'.repeat(60)));
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

program.parse();
