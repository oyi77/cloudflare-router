#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const { loadConfig, saveConfig, loadMappings, addMapping, removeMapping, toggleMapping, getConfigDir } = require('./config');
const { generateAllNginxConfigs, getNginxStatus } = require('./nginx');
const { generateTunnelConfig, getTunnelStatus } = require('./tunnel');
const { verifyToken, deployAllMappings, listDNSRecords } = require('./cloudflare');
const { startServer } = require('./server');
const { startMCPServer } = require('./mcp');

const program = new Command();

program
  .name('cloudflare-router')
  .description('Manage Cloudflare Tunnels, nginx reverse proxies, and DNS records')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize configuration')
  .option('--token <token>', 'Cloudflare API token')
  .option('--zone <zone_id>', 'Cloudflare Zone ID')
  .option('--tunnel <tunnel_id>', 'Cloudflare Tunnel ID')
  .option('--domain <domain>', 'Root domain (e.g., example.com)')
  .option('--credentials <path>', 'Path to tunnel credentials JSON')
  .action(async (options) => {
    const config = loadConfig();

    if (options.token) config.cloudflare.api_token = options.token;
    if (options.zone) config.cloudflare.zone_id = options.zone;
    if (options.tunnel) config.cloudflare.tunnel_id = options.tunnel;
    if (options.domain) config.cloudflare.domain = options.domain;
    if (options.credentials) config.cloudflare.tunnel_credentials = options.credentials;

    saveConfig(config);
    console.log(chalk.green('✓ Configuration saved'));
    console.log(chalk.gray(`  Config dir: ${getConfigDir()}`));
    console.log(chalk.gray(`  Domain: ${config.cloudflare.domain || 'not set'}`));

    if (config.cloudflare.api_token) {
      console.log(chalk.blue('\nVerifying API token...'));
      const result = await verifyToken();
      if (result.valid) {
        console.log(chalk.green('✓ API token is valid'));
      } else {
        console.log(chalk.red('✗ API token verification failed: ' + result.error));
      }
    }
  });

program
  .command('add')
  .description('Add or update a subdomain mapping')
  .argument('<subdomain>', 'Subdomain name (e.g., api)')
  .argument('<port>', 'Local port number')
  .option('-d, --description <desc>', 'Description')
  .action((subdomain, port, options) => {
    const mappings = addMapping(subdomain, parseInt(port), options.description || '');
    console.log(chalk.green(`✓ Mapping added: ${subdomain} → localhost:${port}`));
    console.log(chalk.gray(`  Total mappings: ${mappings.length}`));
  });

program
  .command('remove')
  .description('Remove a subdomain mapping')
  .argument('<subdomain>', 'Subdomain name')
  .action((subdomain) => {
    const mappings = removeMapping(subdomain);
    console.log(chalk.green(`✓ Mapping removed: ${subdomain}`));
    console.log(chalk.gray(`  Total mappings: ${mappings.length}`));
  });

program
  .command('list')
  .description('List all mappings')
  .action(() => {
    const { mappings } = loadMappings();
    if (mappings.length === 0) {
      console.log(chalk.yellow('No mappings configured'));
      return;
    }

    console.log(chalk.bold('\nSubdomain Mappings:'));
    console.log(chalk.gray('─'.repeat(60)));

    mappings.forEach(m => {
      const status = m.enabled !== false ? chalk.green('●') : chalk.red('○');
      const desc = m.description ? chalk.gray(` (${m.description})`) : '';
      console.log(`${status} ${chalk.cyan(m.subdomain.padEnd(20))} → localhost:${m.port}${desc}`);
    });

    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray(`Total: ${mappings.length} mappings`));
  });

program
  .command('generate')
  .description('Generate nginx and tunnel configs')
  .action(() => {
    console.log(chalk.blue('Generating nginx configs...'));
    const nginxResult = generateAllNginxConfigs();
    console.log(chalk.green(`✓ Generated ${nginxResult.total} nginx site configs`));
    console.log(chalk.gray(`  Main config: ${nginxResult.main_config}`));

    console.log(chalk.blue('\nGenerating tunnel config...'));
    const tunnelResult = generateTunnelConfig();
    console.log(chalk.green(`✓ Generated tunnel config with ${tunnelResult.ingress_rules} ingress rules`));
    console.log(chalk.gray(`  Config: ${tunnelResult.config_path}`));
    tunnelResult.domains.forEach(d => {
      console.log(chalk.gray(`  • ${d}`));
    });
  });

program
  .command('deploy')
  .description('Deploy DNS records to Cloudflare')
  .action(async () => {
    console.log(chalk.blue('Deploying DNS records to Cloudflare...'));
    try {
      const results = await deployAllMappings();
      results.forEach(r => {
        if (r.status === 'created') {
          console.log(chalk.green(`✓ Created DNS record for ${r.subdomain}`));
        } else if (r.status === 'exists') {
          console.log(chalk.yellow(`• DNS record exists for ${r.subdomain}`));
        } else {
          console.log(chalk.red(`✗ Failed for ${r.subdomain}: ${r.error}`));
        }
      });
    } catch (error) {
      console.log(chalk.red('✗ Deploy failed: ' + error.message));
    }
  });

program
  .command('status')
  .description('Show system status')
  .action(() => {
    const config = loadConfig();
    const { mappings } = loadMappings();
    const nginxStatus = getNginxStatus();
    const tunnelStatus = getTunnelStatus();

    console.log(chalk.bold('\nCloudflare Router Status:'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(`Domain:     ${chalk.cyan(config.cloudflare.domain || 'not configured')}`);
    console.log(`Nginx:      ${nginxStatus.running ? chalk.green('Running') : chalk.red('Stopped')} (${nginxStatus.processes} processes)`);
    console.log(`Tunnel:     ${tunnelStatus.running ? chalk.green('Running') : chalk.red('Stopped')} (${tunnelStatus.processes} processes)`);
    console.log(`Mappings:   ${chalk.cyan(mappings.filter(m => m.enabled !== false).length)} enabled / ${mappings.length} total`);
    console.log(chalk.gray('─'.repeat(60)));
  });

program
  .command('dashboard')
  .description('Start web dashboard')
  .option('-p, --port <port>', 'Dashboard port', '7070')
  .action(async (options) => {
    const port = parseInt(options.port);
    await startServer(port);
  });

program
  .command('dns')
  .description('List Cloudflare DNS records')
  .action(async () => {
    try {
      console.log(chalk.blue('Fetching DNS records...'));
      const records = await listDNSRecords();
      console.log(chalk.bold('\nDNS Records:'));
      console.log(chalk.gray('─'.repeat(80)));
      records.forEach(r => {
        console.log(`${chalk.cyan(r.name.padEnd(40))} ${r.type.padEnd(8)} ${chalk.gray(r.content)}`);
      });
      console.log(chalk.gray('─'.repeat(80)));
      console.log(chalk.gray(`Total: ${records.length} records`));
    } catch (error) {
      console.log(chalk.red('✗ Failed: ' + error.message));
    }
  });

program
  .command('mcp')
  .description('Start MCP server for AI agent integration')
  .action(() => {
    startMCPServer();
  });

program.parse();
