'use strict';

const crypto = require('crypto');
const db = require('../index');

async function createUser({ name, email, firefliesApiKey, firefliesWebhookSecret }) {
  const webhookToken = crypto.randomBytes(32).toString('hex');

  const result = await db.query(
    `INSERT INTO users (name, email, webhook_token, fireflies_api_key, fireflies_webhook_secret)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, webhook_token, created_at`,
    [name, email || null, webhookToken, firefliesApiKey, firefliesWebhookSecret],
  );
  return result.rows[0];
}

async function findByToken(token) {
  const result = await db.query(
    'SELECT * FROM users WHERE webhook_token = $1 AND active = TRUE LIMIT 1',
    [token],
  );
  return result.rows[0] || null;
}

async function getRecentActivity(userId, limit = 10) {
  const result = await db.query(
    `SELECT
       w.id,
       w.fireflies_meeting_id,
       w.processing_status,
       w.received_at,
       w.error_message,
       m.hurma_candidate_id,
       m.title,
       m.matched_by
     FROM webhooks w
     LEFT JOIN meetings m ON m.fireflies_meeting_id = w.fireflies_meeting_id
     WHERE w.user_id = $1
     ORDER BY w.received_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return result.rows;
}

module.exports = { createUser, findByToken, getRecentActivity };
