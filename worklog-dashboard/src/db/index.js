const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  require('../utils/logger').error({ err }, 'Unexpected PostgreSQL pool error');
});

/**
 * Execute a parameterised query on the pool.
 * @param {string} text
 * @param {any[]} [params]
 */
async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Obtain a raw client (for transactions).
 */
async function getClient() {
  return pool.connect();
}

/**
 * Simple connection check.
 */
async function ping() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}

async function end() {
  await pool.end();
}

module.exports = { query, getClient, ping, end };
