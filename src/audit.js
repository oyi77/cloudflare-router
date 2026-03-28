/**
 * audit.js — Append-only deployment audit log for CF-Router
 *
 * Log location: ~/.cloudflare-router/logs/audit.log (JSONL format)
 */

const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('./config');

function getAuditFile() {
  const logsDir = path.join(getConfigDir(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, 'audit.log');
}

/**
 * Append an audit entry.
 * @param {string} action  - e.g. 'mapping_added', 'mapping_removed', 'deploy', 'generate', 'rollback'
 * @param {object} data    - { subdomain?, port?, user?, before?, after?, results?, error? }
 */
function logAudit(action, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    action,
    user: data.user || 'system',
    ...data,
  };
  delete entry.user; // re-add at front for readability
  const line = JSON.stringify({ ts: entry.ts, action, user: data.user || 'system', ...data }) + '\n';
  try {
    fs.appendFileSync(getAuditFile(), line, 'utf8');
  } catch (e) {
    // never throw — audit must not break main flow
  }
}

/**
 * Read audit log, newest first.
 * @param {object} opts - { limit=50, action? }
 */
function readAudit({ limit = 50, action = null } = {}) {
  const file = getAuditFile();
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  const filtered = action ? lines.filter(l => l.action === action) : lines;
  return filtered.reverse().slice(0, limit);
}

/**
 * Get audit stats summary.
 */
function auditStats() {
  const file = getAuditFile();
  if (!fs.existsSync(file)) return { total: 0, today: 0, by_action: {} };

  const today = new Date().toISOString().slice(0, 10);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  const by_action = {};
  let todayCount = 0;

  for (const e of entries) {
    by_action[e.action] = (by_action[e.action] || 0) + 1;
    if (e.ts && e.ts.startsWith(today)) todayCount++;
  }

  return { total: entries.length, today: todayCount, by_action };
}

module.exports = { logAudit, readAudit, auditStats };
