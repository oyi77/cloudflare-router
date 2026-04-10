const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const yaml = require('js-yaml');
const { CONFIG_DIR } = require('./config');

const APP_PROCESSES = new Map();
const RESTARTING = new Set();

const APPS_YAML = path.join(CONFIG_DIR, 'apps.yaml');

const ALLOWED_APP_FIELDS = new Set(['command', 'script', 'cwd', 'env', 'mode', 'port', 'restartPolicy', 'enabled', 'autoStart']);
function sanitizeWatchdogCfg(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('App config must be an object');
  const safe = {};
  for (const key of ALLOWED_APP_FIELDS) {
    if (key in cfg) safe[key] = cfg[key];
  }
  return safe;
}

function startAppProcess(name, appCfg, backoff = 1000) {
  if (APP_PROCESSES.has(name)) return;
  let command = appCfg.command || appCfg.script || 'npm start';
  const cwd = appCfg.cwd || path.join(process.env.HOME, 'apps', name);
  const child = exec(command, { cwd, env: { ...process.env, ...appCfg.env } });
  APP_PROCESSES.set(name, { pid: child.pid, started_at: new Date().toISOString(), command });
  console.log(`[auto-start] Started ${name} (PID: ${child.pid})`);

  const policy = appCfg.restartPolicy || 'never';
  child.on('exit', (code) => {
    APP_PROCESSES.delete(name);
    const shouldRestart = policy === 'always' || (policy === 'on-failure' && code !== 0);
    if (shouldRestart) {
      const nextBackoff = Math.min(backoff * 2, 30000);
      console.log(`[watchdog] ${name} exited (code ${code}), restarting in ${backoff}ms`);
      setTimeout(() => {
        try {
          const data = fs.existsSync(APPS_YAML) ? yaml.load(fs.readFileSync(APPS_YAML, 'utf8')) : { apps: {} };
          const rawCfg = data.apps?.[name] || appCfg;
          startAppProcess(name, sanitizeWatchdogCfg(rawCfg), nextBackoff);
        } catch (e) {
          console.warn(`[watchdog] Invalid config for ${name}, using previous config`);
          startAppProcess(name, appCfg, nextBackoff);
        }
      }, backoff);
    }
  });
}

function stopApp(name) {
  const proc = APP_PROCESSES.get(name);
  if (!proc) return false;
  try { process.kill(proc.pid, 'SIGTERM'); } catch (e) { /* already dead */ }
  APP_PROCESSES.delete(name);
  return true;
}

module.exports = { APP_PROCESSES, RESTARTING, startAppProcess, stopApp };
