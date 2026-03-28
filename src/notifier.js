/**
 * notifier.js — Telegram + webhook notifications for CF-Router
 *
 * Events: deploy_success, deploy_fail, service_down, service_up,
 *         ssl_expiry_warning, tunnel_disconnect, mapping_added, mapping_removed
 */

const https = require('https');
const http = require('http');
const { loadConfig, saveConfig } = require('./config');

// Track service state for up/down transitions
const serviceStateCache = new Map(); // port -> 'up' | 'down'

/**
 * Load notification config from config.yml.
 * Returns { telegram: {...}, webhook: {...} }
 */
function getNotifConfig() {
  const config = loadConfig();
  return config.notifications || {
    telegram: { enabled: false, bot_token: '', chat_id: '' },
    webhook: { enabled: false, url: '', events: [] },
  };
}

/**
 * Update notification config.
 */
function saveNotifConfig(notifConfig) {
  const config = loadConfig();
  config.notifications = notifConfig;
  saveConfig(config);
}

/**
 * Format a notification event as a Telegram message.
 */
function formatTelegramMessage(event, data = {}) {
  const icons = {
    deploy_success: '✅',
    deploy_fail: '❌',
    service_down: '🔴',
    service_up: '🟢',
    ssl_expiry_warning: '⚠️',
    tunnel_disconnect: '🔌',
    mapping_added: '➕',
    mapping_removed: '➖',
    test: '🔔',
  };
  const icon = icons[event] || 'ℹ️';
  const ts = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour12: false });

  let body = '';
  switch (event) {
    case 'deploy_success':
      body = `DNS deployed successfully.\n${data.count ? `Records: ${data.count}` : ''}`;
      break;
    case 'deploy_fail':
      body = `DNS deploy FAILED.\nError: ${data.error || 'unknown'}`;
      break;
    case 'service_down':
      body = `Service is DOWN!\nService: <code>${data.subdomain || data.service}</code>\nPort: ${data.port}\nLatency: N/A`;
      break;
    case 'service_up':
      body = `Service recovered.\nService: <code>${data.subdomain || data.service}</code>\nPort: ${data.port}\nLatency: ${data.latency ? `${data.latency}ms` : 'ok'}`;
      break;
    case 'ssl_expiry_warning':
      body = `SSL certificate expiring soon!\nDomain: <code>${data.domain}</code>\nExpires in: ${data.days_left} days`;
      break;
    case 'tunnel_disconnect':
      body = `Cloudflare Tunnel disconnected!\nTunnel: ${data.tunnel_id || 'unknown'}`;
      break;
    case 'mapping_added':
      body = `New mapping added.\nSubdomain: <code>${data.subdomain}</code>\nPort: ${data.port}${data.description ? `\nDesc: ${data.description}` : ''}`;
      break;
    case 'mapping_removed':
      body = `Mapping removed.\nSubdomain: <code>${data.subdomain}</code>`;
      break;
    case 'test':
      body = 'CF-Router notifications are working! 🎉';
      break;
    default:
      body = JSON.stringify(data, null, 2);
  }

  return `${icon} <b>CF-Router</b> — ${event.replace(/_/g, ' ').toUpperCase()}\n\n${body}\n\n<i>${ts} WIB</i>`;
}

/**
 * Send Telegram message.
 */
async function sendTelegram(botToken, chatId, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok) resolve(parsed);
          else reject(new Error(parsed.description || 'Telegram API error'));
        } catch {
          reject(new Error('Failed to parse Telegram response'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Telegram request timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Send webhook notification.
 */
async function sendWebhook(webhookUrl, event, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ event, data, ts: new Date().toISOString(), source: 'cf-router' });
    const url = new URL(webhookUrl);
    const mod = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };

    const req = mod.request(options, (res) => {
      res.resume();
      resolve({ status: res.statusCode });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Webhook timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Main notify function — sends to all configured channels.
 * Never throws — notifications must not break main flow.
 */
async function notify(event, data = {}) {
  try {
    const notifConfig = getNotifConfig();

    // Telegram
    const tg = notifConfig.telegram || {};
    const botToken = tg.bot_token || process.env.CFR_TELEGRAM_TOKEN || '';
    const chatId = tg.chat_id || process.env.CFR_TELEGRAM_CHAT_ID || '';
    if (tg.enabled && botToken && chatId) {
      try {
        const msg = formatTelegramMessage(event, data);
        await sendTelegram(botToken, chatId, msg);
      } catch (e) {
        console.error(`[notifier] Telegram error: ${e.message}`);
      }
    }

    // Webhook
    const wh = notifConfig.webhook || {};
    if (wh.enabled && wh.url) {
      const events = wh.events || [];
      if (events.length === 0 || events.includes(event)) {
        try {
          await sendWebhook(wh.url, event, data);
        } catch (e) {
          console.error(`[notifier] Webhook error: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.error(`[notifier] Unexpected error: ${e.message}`);
  }
}

/**
 * Track service health transitions (up ↔ down) and notify on change.
 * Call this from health check loops.
 */
async function trackServiceHealth(port, subdomain, isUp, latency = null) {
  const key = `${port}`;
  const prev = serviceStateCache.get(key);
  const current = isUp ? 'up' : 'down';

  if (prev !== current) {
    serviceStateCache.set(key, current);
    if (isUp) {
      await notify('service_up', { port, subdomain, latency });
    } else {
      await notify('service_down', { port, subdomain });
    }
  }
}

/**
 * Mask sensitive fields for API responses.
 */
function maskNotifConfig(cfg) {
  const masked = JSON.parse(JSON.stringify(cfg));
  if (masked.telegram?.bot_token) {
    masked.telegram.bot_token = masked.telegram.bot_token.slice(0, 6) + '***';
  }
  return masked;
}

module.exports = { notify, trackServiceHealth, getNotifConfig, saveNotifConfig, maskNotifConfig, formatTelegramMessage };
