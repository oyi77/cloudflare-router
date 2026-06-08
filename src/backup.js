const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig, CONFIG_DIR, MAPPINGS_DIR } = require('./config');
const { BACKUP_DIR, BACKUP_RETENTION_DAYS, YAML_FILENAME_REGEX, HEALTHCHECK_HISTORY_MAX } = require('./constants');

const backupsDir = BACKUP_DIR;
const healthHistory = [];

function ensureBackupDir() {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
}

function createBackup() {
  ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupsDir, `backup-${timestamp}.json`);
  
  const backup = {
    timestamp: new Date().toISOString(),
    config: loadConfig(),
    mappings: {}
  };
  
  if (fs.existsSync(MAPPINGS_DIR)) {
    fs.readdirSync(MAPPINGS_DIR).filter(f => f.endsWith('.yml')).forEach(f => {
      backup.mappings[f] = fs.readFileSync(path.join(MAPPINGS_DIR, f), 'utf8');
    });
  }
  
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  
  cleanupOldBackups();
  
  return { file: backupFile, timestamp: backup.timestamp };
}

function restoreBackup(backupFile) {
  if (!fs.existsSync(backupFile)) throw new Error('Backup file not found');
  
  const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  
  if (backup.config) saveConfig(backup.config);
  
   if (backup.mappings) {
     if (!fs.existsSync(MAPPINGS_DIR)) fs.mkdirSync(MAPPINGS_DIR, { recursive: true });
     Object.entries(backup.mappings).forEach(([filename, content]) => {
       if (!YAML_FILENAME_REGEX.test(filename)) return; // skip unsafe
      const resolved = path.resolve(MAPPINGS_DIR, filename);
      if (!resolved.startsWith(path.resolve(MAPPINGS_DIR))) return;
      fs.writeFileSync(resolved, content);
    });
  }
  
  return { restored: true, timestamp: backup.timestamp };
}

function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(backupsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const stat = fs.statSync(path.join(backupsDir, f));
      return {
        file: f,
        path: path.join(backupsDir, f),
        size: stat.size,
        created: stat.mtime.toISOString()
      };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));
}

function cleanupOldBackups(backupDir = backupsDir, retentionDays = BACKUP_RETENTION_DAYS) {
   const now = Date.now();
   const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  let deletedCount = 0;

  if (!fs.existsSync(backupDir)) return { deleted: 0, kept: 0 };

  const backups = fs.readdirSync(backupDir).filter(f => 
    f.endsWith('.json') || f.endsWith('.yaml')
  );

  backups.forEach(filename => {
    const filePath = path.join(backupDir, filename);
    try {
      const stat = fs.statSync(filePath);
      const age = now - stat.mtimeMs;

      if (age > retentionMs) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    } catch (error) {
      console.error(`[Cleanup] Failed to process ${filename}:`, error.message);
    }
  });

   const keptCount = backups.length - deletedCount;
   if (deletedCount > 0) {
     console.log(`[Cleanup] Deleted ${deletedCount} old backups (>${BACKUP_RETENTION_DAYS} days). Kept ${keptCount} recent backups.`);
  }

  return { deleted: deletedCount, kept: keptCount };
}

async function runHealthCheck(urls) {
   const axios = require('axios');
   const { HTTP_MEDIUM_TIMEOUT_MS: timeout } = require('./constants');
   const results = [];
   for (const { name, url } of urls) {
     const startTime = Date.now();
     try {
       new URL(url); // validates URL format, throws on invalid
       const response = await axios.get(url, {
         timeout,
        validateStatus: () => true,
        maxRedirects: 3,
      });
      const latency = Date.now() - startTime;
      results.push({
        name, url,
        status: response.status >= 200 && response.status < 400 ? 'healthy' : 'unhealthy',
        httpStatus: response.status,
        latency,
        checkedAt: new Date().toISOString()
      });
    } catch (error) {
      results.push({
        name, url,
        status: 'unhealthy',
        error: error.message,
        checkedAt: new Date().toISOString()
      });
    }
  }

   healthHistory.push({
     timestamp: new Date().toISOString(),
     results
   });

   if (healthHistory.length > HEALTHCHECK_HISTORY_MAX) healthHistory.shift();

  return results;
}

function getHealthHistory(hours = 24) {
   const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
   return healthHistory.filter(h => h.timestamp > cutoff);
 }

function getBackupConfig() {
  const configDir = CONFIG_DIR;
  const configFile = path.join(configDir, 'backup-config.json');
  
  if (fs.existsSync(configFile)) {
    return JSON.parse(fs.readFileSync(configFile, 'utf8'));
  }
  
  return {
    enabled: true,
    intervalHours: 24,
    maxBackups: 30,
    lastBackup: null
  };
}

function saveBackupConfig(config) {
  const configFile = path.join(CONFIG_DIR, 'backup-config.json');
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
}

let backupInterval = null;

function startAutoBackup(intervalHours = 24) {
  if (backupInterval) clearInterval(backupInterval);
  
  backupInterval = setInterval(() => {
    try {
      const backup = createBackup();
      const config = getBackupConfig();
      config.lastBackup = backup.timestamp;
      saveBackupConfig(config);
      console.log(`[Auto Backup] Created: ${backup.file}`);
    } catch (error) {
      console.error(`[Auto Backup] Error: ${error.message}`);
    }
  }, intervalHours * 3600000);
  
  const config = getBackupConfig();
  if (!config.lastBackup || new Date() - new Date(config.lastBackup) > intervalHours * 3600000) {
    createBackup();
  }
}

function stopAutoBackup() {
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
  }
}

/**
 * createAutoBackup — called before generate/deploy.
 * Creates a timestamped auto-backup with prefix 'auto-'.
 * Keeps max 50 auto-backups (separate from manual).
 */
function createAutoBackup() {
  ensureBackupDir();
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const backupFile = path.join(backupsDir, `auto-${ts}.json`);

  // Don't double-backup within 30 seconds
  const recent = fs.readdirSync(backupsDir)
    .filter(f => f.startsWith('auto-'))
    .sort()
    .reverse()[0];
  if (recent) {
    const recentTs = fs.statSync(path.join(backupsDir, recent)).mtimeMs;
    if (Date.now() - recentTs < 30000) return { file: path.join(backupsDir, recent), skipped: true };
  }

  const backup = {
    timestamp: new Date().toISOString(),
    type: 'auto',
    config: loadConfig(),
    mappings: {},
  };

  if (fs.existsSync(MAPPINGS_DIR)) {
    fs.readdirSync(MAPPINGS_DIR).filter(f => f.endsWith('.yml')).forEach(f => {
      backup.mappings[f] = fs.readFileSync(path.join(MAPPINGS_DIR, f), 'utf8');
    });
  }

  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));

  // Keep max 50 auto-backups
  const autoBackups = fs.readdirSync(backupsDir)
    .filter(f => f.startsWith('auto-') && f.endsWith('.json'))
    .sort();
  if (autoBackups.length > 50) {
    autoBackups.slice(0, autoBackups.length - 50).forEach(f => {
      try { fs.unlinkSync(path.join(backupsDir, f)); } catch {}
    });
  }

  return { file: backupFile, timestamp: backup.timestamp };
}

/**
 * rollback — restore from the most recent or a specific backup file.
 * @param {string|null} file - basename or full path. null = most recent auto backup.
 */
function rollback(file = null) {
  ensureBackupDir();
  let backupPath;

  if (!file) {
    // Most recent auto backup
    const autoBackups = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('auto-') && f.endsWith('.json'))
      .sort()
      .reverse();
    if (!autoBackups.length) {
      const allBackups = listBackups();
      if (!allBackups.length) throw new Error('No backups found');
      backupPath = allBackups[0].path;
    } else {
      backupPath = path.join(backupsDir, autoBackups[0]);
    }
  } else {
    // Accept basename or full path
    backupPath = path.isAbsolute(file) ? file : path.join(backupsDir, file);
    if (!fs.existsSync(backupPath)) throw new Error(`Backup not found: ${backupPath}`);
  }

  const result = restoreBackup(backupPath);
  return { ...result, file: path.basename(backupPath) };
}

/**
 * listRecentBackups — list last N backups (auto + manual combined).
 */
function listRecentBackups(limit = 10) {
  ensureBackupDir();
  return fs.readdirSync(backupsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const stat = fs.statSync(path.join(backupsDir, f));
      return { file: f, path: path.join(backupsDir, f), size: stat.size, created: stat.mtime.toISOString(), type: f.startsWith('auto-') ? 'auto' : 'manual' };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created))
    .slice(0, limit);
}

module.exports = {
  createBackup,
  createAutoBackup,
  restoreBackup,
  rollback,
  listBackups,
  listRecentBackups,
  runHealthCheck,
  getHealthHistory,
  getBackupConfig,
  saveBackupConfig,
  startAutoBackup,
  stopAutoBackup,
};
