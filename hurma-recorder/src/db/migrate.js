'use strict';

/**
 * Simple migration runner.
 * Reads SQL files from ./migrations/ in alphabetical order and executes them.
 * Tracks applied migrations in the schema_migrations table.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // Ensure migration tracking table exists before anything else
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = path.basename(file, '.sql');
      const { rows } = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [version],
      );

      if (rows.length > 0) {
        console.log(`[migration] skipping ${version} (already applied)`);
        continue;
      }

      console.log(`[migration] applying ${version}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      console.log(`[migration] ${version} applied`);
    }

    console.log('[migration] all migrations complete');
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('[migration] fatal error:', err.message);
  process.exit(1);
});
