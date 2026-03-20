#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const { loadConfig, addAccount, removeAccount, addZoneToAccount, removeZoneFromAccount, addMapping, removeMapping, toggleMapping, getAllMappings, getConfigDir } = require('./config');
const { generateAllNginxConfigs, getNginxStatus } = require('./nginx');
const { verifyAccount, discoverZones, deployMappingsForZone, listDNSRecords } = require('./cloudflare');
const { startServer } = require('./server');

const program = new Command();
program.name('cloudflare-router').description('Manage Cloudflare Tunnels, nginx, and DNS from one place').version('1.1.0');

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

program.parse();
