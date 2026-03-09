'use strict';

const db = require('../index');

async function insertManualReview({ fireflysMeetingId, fireflysTranscriptId, reason, payloadJson }) {
  const result = await db.query(
    `INSERT INTO manual_review_queue
       (fireflies_meeting_id, fireflies_transcript_id, reason, payload_json, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id`,
    [fireflysMeetingId, fireflysTranscriptId, reason, JSON.stringify(payloadJson)],
  );
  return result.rows[0];
}

async function listPendingReviews() {
  const result = await db.query(
    `SELECT * FROM manual_review_queue WHERE status = 'pending' ORDER BY created_at ASC`,
  );
  return result.rows;
}

async function resolveManualReview(id) {
  await db.query(
    `UPDATE manual_review_queue SET status = 'resolved', resolved_at = NOW() WHERE id = $1`,
    [id],
  );
}

module.exports = { insertManualReview, listPendingReviews, resolveManualReview };
