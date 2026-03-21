const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadConfig, saveConfig, CONFIG_DIR, MAPPINGS_DIR } = require('./config');

const backupsDir = path.join(CONFIG_DIR, 'backups');
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
      fs.writeFileSync(path.join(MAPPINGS_DIR, filename), content);
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

function cleanupOldBackups(maxBackups = 30) {
  const backups = listBackups();
  if (backups.length > maxBackups) {
    backups.slice(maxBackups).forEach(b => {
      fs.unlinkSync(b.path);
    });
  }
}

function runHealthCheck(urls) {
  const results = [];
  
  urls.forEach(({ name, url }) => {
    try {
      const startTime = Date.now();
      const status = execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${url}"`, { encoding: 'utf8' }).trim();
      const latency = Date.now() - startTime;
      
      results.push({
        name,
        url,
        status: status === '200' ? 'healthy' : 'unhealthy',
        httpStatus: parseInt(status),
        latency,
        checkedAt: new Date().toISOString()
      });
    } catch (error) {
      results.push({
        name,
        url,
        status: 'unhealthy',
        error: error.message,
        checkedAt: new Date().toISOString()
      });
    }
  });
  
  healthHistory.push({
    timestamp: new Date().toISOString(),
    results
  });
  
  if (healthHistory.length > 1440) healthHistory.shift();
  
  return results;
}

function getHealthHistory(hours = 24) {
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
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

module.exports = {
  createBackup,
  restoreBackup,
  listBackups,
  runHealthCheck,
  getHealthHistory,
  getBackupConfig,
  saveBackupConfig,
  startAutoBackup,
  stopAutoBackup
};
