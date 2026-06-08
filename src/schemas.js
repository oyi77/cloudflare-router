/**
 * schemas.js — Zod validation schemas for API request boundaries
 *
 * Ensures all input conforms to expected types before business logic.
 * Exported schemas are used in request handlers via try/catch on Schema.parse(req.body).
 */

const { z } = require('zod');

// Regex patterns for validation
const SUBDOMAIN_REGEX = /^[a-zA-Z0-9_-]{1,63}$/;
const FQDN_REGEX = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const APP_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

// Reusable field schemas
const SubdomainSchema = z.string()
  .min(1, 'Subdomain cannot be empty')
  .max(63, 'Subdomain max 63 characters')
  .regex(SUBDOMAIN_REGEX, 'Valid subdomain required (alphanumeric, hyphens, underscores, 1-63 chars)');

const PortSchema = z.number()
  .int('Port must be an integer')
  .min(1, 'Port must be >= 1')
  .max(65535, 'Port must be <= 65535');

const DomainSchema = z.string()
  .min(1, 'Domain cannot be empty')
  .regex(FQDN_REGEX, 'Valid FQDN required (e.g. example.com)');

const EmailSchema = z.string()
  .email('Invalid email format')
  .or(z.literal(''))
  .optional()
  .default('');

const IPV4Schema = z.string()
  .regex(IPV4_REGEX, 'Valid IPv4 address required');

const AppNameSchema = z.string()
  .min(1, 'App name cannot be empty')
  .max(128, 'App name max 128 characters')
  .regex(APP_NAME_REGEX, 'Valid app name required (alphanumeric, hyphens, underscores)');

const APIKeySchema = z.string()
  .min(1, 'API key cannot be empty')
  .max(200, 'API key max 200 characters');

const ZoneIdSchema = z.string()
  .min(1, 'Zone ID cannot be empty')
  .max(64, 'Zone ID max 64 characters');

const AccountIdSchema = z.string()
  .min(1, 'Account ID cannot be empty')
  .max(255, 'Account ID max 255 characters');

// Endpoint schemas

/**
 * POST /api/auth/login
 * { username, password }
 */
const AuthLoginSchema = z.object({
  username: z.string()
    .max(100, 'Username max 100 characters')
    .optional()
    .default(''),
  password: z.string()
    .max(255, 'Password max 255 characters')
    .optional()
    .default('')
});

/**
 * POST /api/accounts
 * { name, email, api_key?, api_token? }
 */
const AccountCreateSchema = z.object({
  name: z.string()
    .min(1, 'Account name required')
    .max(100, 'Account name max 100 characters'),
  email: EmailSchema,
  api_key: APIKeySchema.optional(),
  api_token: APIKeySchema.optional()
}).refine(
  obj => obj.api_key || obj.api_token,
  { message: 'Either api_key or api_token required' }
);

/**
 * POST /api/accounts/:id/zones
 * { zone_id, domain, tunnel_id?, tunnel_credentials? }
 */
const ZoneAddSchema = z.object({
  zone_id: ZoneIdSchema,
  domain: DomainSchema,
  tunnel_id: z.string()
    .max(255, 'Tunnel ID max 255 characters')
    .optional()
    .default(''),
  tunnel_credentials: z.string()
    .max(5000, 'Tunnel credentials max 5000 characters')
    .optional()
    .default('')
});

/**
 * POST /api/mappings
 * { account_id, zone_id, subdomain, port, description?, protocol?, template?, nginx_extra? }
 */
const MappingCreateSchema = z.object({
  account_id: AccountIdSchema,
  zone_id: ZoneIdSchema,
  subdomain: SubdomainSchema,
  port: PortSchema,
  description: z.string()
    .max(200, 'Description max 200 characters')
    .optional()
    .default(''),
  protocol: z.enum(['http', 'https'])
    .optional()
    .default('http'),
  template: z.string()
    .max(128, 'Template max 128 characters')
    .optional()
    .default('default'),
  nginx_extra: z.string()
    .max(5000, 'nginx_extra max 5000 characters')
    .optional()
    .default('')
});

/**
 * PUT /api/mappings/:account/:zone/:subdomain
 * Same fields as MappingCreateSchema, all optional
 */
const MappingUpdateSchema = MappingCreateSchema.partial();

/**
 * POST /api/ip/whitelist or /api/ip/blacklist
 * { ip }
 */
const IpWhitelistSchema = z.object({
  ip: z.string()
    .min(1, 'IP address required')
    .max(45, 'IP address max 45 characters')
    .regex(/^(\d{1,3}\.){3}\d{1,3}$|^([0-9a-fA-F:]+)$/, 'Valid IP address required (IPv4 or IPv6)')
});

const IpBlacklistSchema = IpWhitelistSchema;

/**
 * PUT /api/backup/config
 * { auto_backup_enabled?, interval_days? }
 */
const BackupConfigSchema = z.object({
  auto_backup_enabled: z.boolean().optional(),
  interval_days: z.number()
    .int('interval_days must be integer')
    .min(1, 'interval_days >= 1')
    .optional()
});

/**
 * PUT /api/apps
 * { name, config }
 */
const AppUpdateSchema = z.object({
  name: AppNameSchema,
  config: z.record(z.any())
});

/**
 * POST /api/health-check/add
 * { account_id, zone_id, subdomain, interval?, timeout? }
 */
const HealthCheckAddSchema = z.object({
  account_id: AccountIdSchema,
  zone_id: ZoneIdSchema,
  subdomain: SubdomainSchema,
  interval: z.number()
    .int('interval must be integer')
    .min(10, 'interval >= 10 seconds')
    .optional()
    .default(60),
  timeout: z.number()
    .int('timeout must be integer')
    .min(1, 'timeout >= 1 second')
    .optional()
    .default(10)
});

/**
 * PUT /api/settings
 * Settings object (flexible structure)
 */
const SettingsUpdateSchema = z.object({
  auto_deploy: z.boolean().optional(),
  auto_backup: z.boolean().optional(),
  backup_interval: z.number().int().min(1).optional(),
  backup_dir: z.string().max(500).optional()
}).passthrough(); // Allow additional unknown fields

/**
 * PUT /api/notifications/config
 * { enabled?, provider?, webhook_url? }
 */
const NotificationsConfigSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.string().max(50).optional(),
  webhook_url: z.string().url('Valid URL required').optional()
}).passthrough();

module.exports = {
  // Field schemas
  SubdomainSchema,
  PortSchema,
  DomainSchema,
  EmailSchema,
  IPV4Schema,
  AppNameSchema,
  APIKeySchema,
  ZoneIdSchema,
  AccountIdSchema,

  // Endpoint schemas
  AuthLoginSchema,
  AccountCreateSchema,
  ZoneAddSchema,
  MappingCreateSchema,
  MappingUpdateSchema,
  IpWhitelistSchema,
  IpBlacklistSchema,
  BackupConfigSchema,
  AppUpdateSchema,
  HealthCheckAddSchema,
  SettingsUpdateSchema,
  NotificationsConfigSchema,

  // Regex patterns (for reference)
  SUBDOMAIN_REGEX,
  FQDN_REGEX,
  EMAIL_REGEX,
  IPV4_REGEX,
  APP_NAME_REGEX
};
