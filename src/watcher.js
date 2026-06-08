#!/usr/bin/env node

/**
 * File watcher for cf-router mapping files
 * Automatically regenerates tunnel config when mapping files change
 *
 * Usage:
 *   node src/watcher.js
 *   npm run watcher
 */

const chokidar = require('chokidar');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const { MAPPINGS_DIR: mappingsDirConst, DEBOUNCE_MS, LOG_DIR } = require('./constants');

// Configuration
const MAPPINGS_DIR = mappingsDirConst;
const ROUTER_DIR = path.dirname(path.dirname(__filename));
const LOG_FILE = path.join(LOG_DIR, 'watcher.log');

// Ensure logs directory exists
const logsDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Logger
function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: chalk.blue('[INFO]'),
    success: chalk.green('[✓]'),
    error: chalk.red('[✗]'),
    warn: chalk.yellow('[!]')
  }[level] || chalk.gray('[LOG]');

  const logMessage = `${timestamp} ${prefix} ${message}`;
  console.log(logMessage);

  // Also write to file
  try {
    fs.appendFileSync(LOG_FILE, `${timestamp} [${level.toUpperCase()}] ${message}\n`);
  } catch (err) {
    console.error('Failed to write to log file:', err.message);
  }
}

// Debounce timer
let debounceTimer = null;

// Execute regeneration
function regenerateConfig() {
  try {
    log('Regenerating tunnel config...', 'info');
    
     // Run generate command
     const { stdout } = execFileSync('node', ['src/cli.js', 'generate'], {
       cwd: ROUTER_DIR,
       encoding: 'utf-8',
       timeout: 30000,
       stdio: ['ignore', 'pipe', 'pipe']
     });
     const result = stdout;

    log('Config regenerated successfully', 'success');
    log(`Output: ${result.trim()}`, 'info');

    // Optional: Auto-sync to Cloudflare (uncomment to enable)
    // try {
    //   log('Syncing to Cloudflare...', 'info');
    //   execSync('python3 sync-tunnel-config.py', {
    //     cwd: ROUTER_DIR,
    //     encoding: 'utf-8',
    //     stdio: 'pipe'
    //   });
    //   log('Sync completed', 'success');
    // } catch (syncErr) {
    //   log(`Sync failed: ${syncErr.message}`, 'warn');
    // }

  } catch (err) {
    log(`Regeneration failed: ${err.message}`, 'error');
  }
}

// Debounced regeneration
function scheduleRegeneration() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    regenerateConfig();
    debounceTimer = null;
  }, DEBOUNCE_MS);
}

// Initialize watcher
function startWatcher() {
  log(`Starting file watcher for ${MAPPINGS_DIR}`, 'info');

  const watcher = chokidar.watch(MAPPINGS_DIR, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  watcher
    .on('add', (filePath) => {
      log(`Mapping file added: ${path.basename(filePath)}`, 'info');
      scheduleRegeneration();
    })
    .on('change', (filePath) => {
      log(`Mapping file changed: ${path.basename(filePath)}`, 'info');
      scheduleRegeneration();
    })
    .on('unlink', (filePath) => {
      log(`Mapping file deleted: ${path.basename(filePath)}`, 'info');
      scheduleRegeneration();
    })
    .on('error', (error) => {
      log(`Watcher error: ${error.message}`, 'error');
    });

  log('File watcher started. Watching for changes...', 'success');

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('Shutting down watcher...', 'info');
    watcher.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('Received SIGTERM, shutting down...', 'info');
    watcher.close();
    process.exit(0);
  });
}

// Start the watcher
startWatcher();
