'use strict';

const db = require('../index');

/**
 * Check whether a note with this content hash was already pushed for this candidate.
 * Prevents duplicate Hurma notes on webhook replay.
 */
async function findNoteByHash(hurmaCandidateId, contentHash) {
  const result = await db.query(
    `SELECT id FROM hurma_notes
     WHERE hurma_candidate_id = $1 AND content_hash = $2
     LIMIT 1`,
    [hurmaCandidateId, contentHash],
  );
  return result.rows[0] || null;
}

async function insertNote({ meetingId, hurmaCandidateId, hummaNoteExternalId, contentHash }) {
  const result = await db.query(
    `INSERT INTO hurma_notes (meeting_id, hurma_candidate_id, hurma_note_external_id, content_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (hurma_candidate_id, content_hash) DO NOTHING
     RETURNING id`,
    [meetingId, hurmaCandidateId, hummaNoteExternalId, contentHash],
  );
  return result.rows[0] || null;
}

module.exports = { findNoteByHash, insertNote };
