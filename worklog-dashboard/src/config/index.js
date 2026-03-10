require('dotenv').config();
const { z } = require('zod');

const schema = z.object({
  PORT: z.coerce.number().default(3200),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Hurma HR API — base URL of the Hurma instance, e.g. https://bestwork.hurma.work
  HURMA_BASE_URL: z.string().url('HURMA_BASE_URL must be a valid URL'),
  // Bearer token for Hurma REST API
  HURMA_API_TOKEN: z.string().min(1, 'HURMA_API_TOKEN is required'),
  // v1 for HR/employee endpoints, v3 for ATS endpoints (check swagger-ui.hurma.work)
  HURMA_HR_API_VERSION: z.enum(['v1', 'v3']).default('v1'),

  // Redmine API
  REDMINE_BASE_URL: z.string().url().default('https://project.mirko.in.ua'),
  REDMINE_API_KEY: z.string().min(1, 'REDMINE_API_KEY is required'),

  // Admin auth — protect the dashboard with HTTP Basic Auth
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().min(1, 'ADMIN_PASSWORD is required'),

  DEFAULT_TIMEZONE: z.string().default('Europe/Kiev'),

  // Working hours per day (configurable; default Ukrainian standard = 8h)
  DEFAULT_WORK_HOURS_PER_DAY: z.coerce.number().default(8),

  // Delta threshold (hours) within which status is considered OK
  OK_DELTA_THRESHOLD_HOURS: z.coerce.number().default(0.5),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid configuration:\n', result.error.format());
  process.exit(1);
}

module.exports = result.data;
