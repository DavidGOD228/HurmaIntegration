'use strict';

require('dotenv').config();

const { z } = require('zod');

// Optional URL: empty string or missing → undefined; if set, must be valid URL
const optionalUrl = z
  .string()
  .optional()
  .transform((v) => (v && String(v).trim() ? String(v).trim() : undefined))
  .refine((v) => !v || /^https?:\/\/.+/.test(v), { message: 'APP_BASE_URL must be a valid URL or empty' });

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid postgres URL'),

  FIREFLIES_API_KEY: z.string().min(1, 'FIREFLIES_API_KEY is required'),
  FIREFLIES_WEBHOOK_SECRET: z.string().min(1, 'FIREFLIES_WEBHOOK_SECRET is required'),

  HURMA_BASE_URL: z.string().url('HURMA_BASE_URL must be a valid URL (e.g. https://yourcompany.hurma.work)'),
  HURMA_API_TOKEN: z.string().min(1, 'HURMA_API_TOKEN is required'),

  DEFAULT_TIMEZONE: z.string().default('UTC'),
  APP_BASE_URL: optionalUrl,
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[config] Invalid environment configuration — fix .env and restart:');
  parsed.error.issues.forEach((issue) => {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

const config = parsed.data;

module.exports = config;
