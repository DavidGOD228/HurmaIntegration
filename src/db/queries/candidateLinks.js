'use strict';

const db = require('../index');

/**
 * Look up a pre-configured external reference → Hurma candidate ID mapping.
 * Used as priority 4 in the candidate resolution chain.
 *
 * @param {string} externalReference - Email, clientReferenceId, or any other key
 * @returns {Promise<{hurma_candidate_id: string}|null>}
 */
async function findByExternalReference(externalReference) {
  const result = await db.query(
    'SELECT hurma_candidate_id FROM candidate_links WHERE external_reference = $1 LIMIT 1',
    [externalReference],
  );
  return result.rows[0] || null;
}

async function insertCandidateLink(externalReference, hurmaCandidateId) {
  await db.query(
    `INSERT INTO candidate_links (external_reference, hurma_candidate_id)
     VALUES ($1, $2)
     ON CONFLICT (external_reference) DO UPDATE SET hurma_candidate_id = EXCLUDED.hurma_candidate_id`,
    [externalReference, hurmaCandidateId],
  );
}

module.exports = { findByExternalReference, insertCandidateLink };
