'use strict';

const crypto = require('crypto');

/**
 * Generates a SHA-256 content hash for a given string.
 * Used to detect duplicate note content before writing to Hurma.
 *
 * @param {string} content
 * @returns {string} hex digest
 */
function hashContent(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Generates a deterministic idempotency key from meeting and candidate IDs.
 *
 * @param {string} fireflysMeetingId
 * @param {string} hurmaCandidateId
 * @returns {string}
 */
function makeIdempotencyKey(fireflysMeetingId, hurmaCandidateId) {
  return crypto
    .createHash('sha256')
    .update(`${fireflysMeetingId}:${hurmaCandidateId}`)
    .digest('hex');
}

module.exports = { hashContent, makeIdempotencyKey };
