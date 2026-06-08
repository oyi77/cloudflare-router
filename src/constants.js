/**
 * constants.js — Single source of truth for all hardcoded values in cf-router
 *
 * Every numeric literal, port, timeout, and magic number is exported here.
 * All values are environment-variable overridable with sensible defaults.
 * Read once at module load, not on every call.
 */

const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT VARIABLE RESOLUTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function resolveEnvInt(envName, defaultValue) {
  const v = process.env[envName];
  if (v == null || v === '') return defaultValue;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

function resolveEnvString(envName, defaultValue) {
  const v = process.env[envName];
  if (v == null) return defaultValue;
  const trimmed = v.trim();
  return trimmed === '' ? defaultValue : trimmed;
}

function resolveEnvIntArray(envName, defaultValue) {
  const v = process.env[envName];
  if (v == null || v === '') return defaultValue;
  try {
    const parsed = v.split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n));
    return parsed.length > 0 ? parsed : defaultValue;
  } catch (_) {
    return defaultValue;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DIRECTORY PATHS (env-overridable defaults)
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG_DIR_DEFAULT = path.join(process.env.HOME, 'projects/cf-router');
const CONFIG_DIR = resolveEnvString('CF_ROUTER_HOME', CONFIG_DIR_DEFAULT);

const LOG_DIR = resolveEnvString(
  'CF_ROUTER_LOG_DIR',
  path.join(CONFIG_DIR, 'logs')
);

const BACKUP_DIR = resolveEnvString(
  'CF_ROUTER_BACKUP_DIR',
  path.join(CONFIG_DIR, 'backups')
);

const MAPPINGS_DIR = resolveEnvString(
  'CF_ROUTER_MAPPINGS_DIR',
  path.join(CONFIG_DIR, 'mappings')
);

const NGINX_SITES_DIR = resolveEnvString(
  'CF_ROUTER_NGINX_SITES_DIR',
  path.join(CONFIG_DIR, 'nginx', 'sites')
);

// ─────────────────────────────────────────────────────────────────────────────
// NETWORK / PORTS
// ─────────────────────────────────────────────────────────────────────────────

const DASHBOARD_PORT = resolveEnvInt('DASHBOARD_PORT', resolveEnvInt('PORT', resolveEnvInt('CF_ROUTER_PORT', 7070)));
const NGINX_LISTEN_PORT = resolveEnvInt('NGINX_LISTEN_PORT', resolveEnvInt('NGINX_PORT', 6969));
const DASHBOARD_HOST = resolveEnvString('DASHBOARD_HOST', resolveEnvString('CF_ROUTER_HOST', '0.0.0.0'));
const NGINX_HTTP_PORT = 80;
const NGINX_HTTPS_PORT = 443;

// ─────────────────────────────────────────────────────────────────────────────
// TIMEOUTS (all in milliseconds)
// ─────────────────────────────────────────────────────────────────────────────

const LOCK_STALE_MS = resolveEnvInt('LOCK_STALE_MS', 5000);
const LOCK_UPDATE_INTERVAL_MS = resolveEnvInt('LOCK_UPDATE_INTERVAL_MS', 1000);
const TOKEN_TTL_MS = resolveEnvInt('TOKEN_TTL_MS', 24 * 60 * 60 * 1000);
const TOKEN_CLEANUP_INTERVAL_MS = resolveEnvInt('TOKEN_CLEANUP_INTERVAL_MS', 15 * 60 * 1000);
const AUTH_RATE_WINDOW_MS = resolveEnvInt('AUTH_RATE_WINDOW_MS', 15 * 60 * 1000);
const API_RATE_WINDOW_MS = resolveEnvInt('API_RATE_WINDOW_MS', 60 * 1000);
const API_RATE_LIMIT_MAX = resolveEnvInt('API_RATE_LIMIT_MAX', 100);
const AUTH_RATE_LIMIT_MAX = resolveEnvInt('AUTH_RATE_LIMIT_MAX', 5);
const DEBOUNCE_MS = resolveEnvInt('DEBOUNCE_MS', 1000);
const SOCKET_TIMEOUT_MS = resolveEnvInt('SOCKET_TIMEOUT_MS', 1500);
const HTTP_TIMEOUT_MS = resolveEnvInt('HTTP_TIMEOUT_MS', 15000);
const HTTP_SHORT_TIMEOUT_MS = resolveEnvInt('HTTP_SHORT_TIMEOUT_MS', 2000);
const HTTP_MEDIUM_TIMEOUT_MS = resolveEnvInt('HTTP_MEDIUM_TIMEOUT_MS', 3000);
const HTTP_LONG_TIMEOUT_MS = resolveEnvInt('HTTP_LONG_TIMEOUT_MS', 10000);
const SHUTDOWN_TIMEOUT_MS = resolveEnvInt('SHUTDOWN_TIMEOUT_MS', 15000);
const APP_SIGKILL_TIMEOUT_MS = resolveEnvInt('APP_SIGKILL_TIMEOUT_MS', 5000);
const APP_RESTART_MAX_BACKOFF_MS = resolveEnvInt('APP_RESTART_MAX_BACKOFF_MS', 30000);
const APP_RESTART_BASE_BACKOFF_MS = resolveEnvInt('APP_RESTART_BASE_BACKOFF_MS', 1000);
const NGINX_RELOAD_TIMEOUT_MS = resolveEnvInt('NGINX_RELOAD_TIMEOUT_MS', 10000);
const HEALTH_CHECK_INTERVAL_MS = resolveEnvInt('HEALTH_CHECK_INTERVAL_MS', 30000);
const BACKUP_DEBOUNCE_MS = resolveEnvInt('BACKUP_DEBOUNCE_MS', 30000);
const SOCKET_SCAN_TIMEOUT_MS = resolveEnvInt('SOCKET_SCAN_TIMEOUT_MS', 1000);
const PORTLESS_LOCK_TIMEOUT_MS = resolveEnvInt('PORTLESS_LOCK_TIMEOUT_MS', 5000);
const PORTLESS_LOCK_STALE_MS = resolveEnvInt('PORTLESS_LOCK_STALE_MS', 5000);
const SS_TIMEOUT_MS = resolveEnvInt('SS_TIMEOUT_MS', 5000);
const HEALTHCHECK_HISTORY_MAX = resolveEnvInt('HEALTHCHECK_HISTORY_MAX', 1440);

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN / AUTH
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_BYTES = resolveEnvInt('TOKEN_BYTES', 32);
const MAX_TOKENS = resolveEnvInt('MAX_TOKENS', 1000);
const BCRYPT_ROUNDS = resolveEnvInt('BCRYPT_ROUNDS', 10);

// ─────────────────────────────────────────────────────────────────────────────
// PORT SCANNER DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PORTS_TO_SCAN = resolveEnvIntArray(
  'DEFAULT_PORTS_TO_SCAN',
  [80, 443, 3000, 3001, 3002, 3003, 5432, 6379, 6969, 7070, 8080, 8443]
);

const RESERVED_PORTS = new Set(
  resolveEnvIntArray('RESERVED_PORTS', [22, 25, 53, 80, 443, 3306, 5432])
);

// ─────────────────────────────────────────────────────────────────────────────
// PORTLESS (Port Registry)
// ─────────────────────────────────────────────────────────────────────────────

const PORTLESS_RANGE_START = resolveEnvInt('PORTLESS_RANGE_START', 4000);
const PORTLESS_RANGE_END = resolveEnvInt('PORTLESS_RANGE_END', 4999);

// ─────────────────────────────────────────────────────────────────────────────
// FILE HANDLING
// ─────────────────────────────────────────────────────────────────────────────

const ACCESS_LOG_MAX_BYTES = resolveEnvInt('ACCESS_LOG_MAX_BYTES', 10 * 1024 * 1024); // 10MB
const ACCESS_LOG_ROTATIONS = resolveEnvInt('ACCESS_LOG_ROTATIONS', 5);
const BACKUP_RETENTION_DAYS = resolveEnvInt('BACKUP_RETENTION_DAYS', 7);
const CMDLINE_MAX_LENGTH = resolveEnvInt('CMDLINE_MAX_LENGTH', 80);
const MAX_REQUEST_BODY_BYTES = resolveEnvString('MAX_REQUEST_BODY_BYTES', '100m');
const WEBSOCKET_TIMEOUT_S = resolveEnvString('WEBSOCKET_TIMEOUT_S', '7d');

// ─────────────────────────────────────────────────────────────────────────────
// APP MANAGER
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_RESTART_POLICY = resolveEnvString('DEFAULT_RESTART_POLICY', 'never');

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION PATTERNS (regex)
// ─────────────────────────────────────────────────────────────────────────────

const SUBDOMAIN_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/i;
const APP_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const YAML_FILENAME_REGEX = /^[a-zA-Z0-9_.-]+\.yml$/;
const JSON_FILENAME_REGEX = /^[a-zA-Z0-9_.-]+\.json$/;
const CONF_FILENAME_REGEX = /^[a-zA-Z0-9_.-]+\.conf$/;
const FQDN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
// Simplified IPv6 regex - sufficient for basic validation
const IPV6_REGEX = /^(([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}|::([0-9a-fA-F]{0,4}:){0,6}[0-9a-fA-F]{0,4}|([0-9a-fA-F]{0,4}:){1,6}:[0-9a-fA-F]{0,4})$/;

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION LIMITS
// ─────────────────────────────────────────────────────────────────────────────

const APP_NAME_MAX_LENGTH = resolveEnvInt('APP_NAME_MAX_LENGTH', 128);
const SUBDOMAIN_MAX_LENGTH = resolveEnvInt('SUBDOMAIN_MAX_LENGTH', 63);
const PORT_MIN = 1;
const PORT_MAX = 65535;
const MAX_PORT_SCAN_COUNT = 100;

// ─────────────────────────────────────────────────────────────────────────────
// HTTP STATUS CODES (constants, not configurable)
// ─────────────────────────────────────────────────────────────────────────────

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_LANGUAGE = 'en';
const DEFAULT_PROTOCOL = 'http';
const CORS_DEFAULT = '*';

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Paths
  CONFIG_DIR,
  LOG_DIR,
  BACKUP_DIR,
  MAPPINGS_DIR,
  NGINX_SITES_DIR,

  // Network / Ports
  DASHBOARD_PORT,
  NGINX_LISTEN_PORT,
  DASHBOARD_HOST,
  NGINX_HTTP_PORT,
  NGINX_HTTPS_PORT,

  // Timeouts (ms)
  LOCK_STALE_MS,
  LOCK_UPDATE_INTERVAL_MS,
  TOKEN_TTL_MS,
  TOKEN_CLEANUP_INTERVAL_MS,
  AUTH_RATE_WINDOW_MS,
  API_RATE_WINDOW_MS,
  API_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_MAX,
  DEBOUNCE_MS,
  SOCKET_TIMEOUT_MS,
  HTTP_TIMEOUT_MS,
  HTTP_SHORT_TIMEOUT_MS,
  HTTP_MEDIUM_TIMEOUT_MS,
  HTTP_LONG_TIMEOUT_MS,
  SHUTDOWN_TIMEOUT_MS,
  APP_SIGKILL_TIMEOUT_MS,
  APP_RESTART_MAX_BACKOFF_MS,
  APP_RESTART_BASE_BACKOFF_MS,
  NGINX_RELOAD_TIMEOUT_MS,
  HEALTH_CHECK_INTERVAL_MS,
  BACKUP_DEBOUNCE_MS,
  SOCKET_SCAN_TIMEOUT_MS,
  PORTLESS_LOCK_TIMEOUT_MS,
  PORTLESS_LOCK_STALE_MS,
  SS_TIMEOUT_MS,
  HEALTHCHECK_HISTORY_MAX,

  // Token / Auth
  TOKEN_BYTES,
  MAX_TOKENS,
  BCRYPT_ROUNDS,

  // Port Scanner
  DEFAULT_PORTS_TO_SCAN,
  RESERVED_PORTS,

  // Portless
  PORTLESS_RANGE_START,
  PORTLESS_RANGE_END,

  // File Handling
  ACCESS_LOG_MAX_BYTES,
  ACCESS_LOG_ROTATIONS,
  BACKUP_RETENTION_DAYS,
  CMDLINE_MAX_LENGTH,
  MAX_REQUEST_BODY_BYTES,
  WEBSOCKET_TIMEOUT_S,

  // App Manager
  DEFAULT_RESTART_POLICY,

  // Validation Patterns
  SUBDOMAIN_REGEX,
  APP_NAME_REGEX,
  YAML_FILENAME_REGEX,
  JSON_FILENAME_REGEX,
  CONF_FILENAME_REGEX,
  FQDN_REGEX,
  EMAIL_REGEX,
  IPV4_REGEX,
  IPV6_REGEX,

  // Validation Limits
  APP_NAME_MAX_LENGTH,
  SUBDOMAIN_MAX_LENGTH,
  PORT_MIN,
  PORT_MAX,
  MAX_PORT_SCAN_COUNT,

  // HTTP Status Codes
  HTTP_OK,
  HTTP_CREATED,
  HTTP_BAD_REQUEST,
  HTTP_UNAUTHORIZED,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_BAD_GATEWAY,
  HTTP_SERVICE_UNAVAILABLE,

  // Defaults
  DEFAULT_LANGUAGE,
  DEFAULT_PROTOCOL,
  CORS_DEFAULT,

  // Helper functions
  resolveEnvInt,
  resolveEnvString,
  resolveEnvIntArray
};
