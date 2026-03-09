'use strict';

require('dotenv').config();

const { z } = require('zod');

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DATABASE_URL: z.string().url(),

  FIREFLIES_API_KEY: z.string().min(1),
  FIREFLIES_WEBHOOK_SECRET: z.string().min(1),

  HURMA_BASE_URL: z.string().url(),
  HURMA_API_TOKEN: z.string().min(1),

  DEFAULT_TIMEZONE: z.string().default('UTC'),
  APP_BASE_URL: z.string().url().optional(),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  parsed.error.issues.forEach((issue) => {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

const config = parsed.data;

module.exports = config;
