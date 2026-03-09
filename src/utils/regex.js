'use strict';

/**
 * Regex patterns used to extract Hurma candidate IDs from meeting metadata.
 * Priority order matches the business specification.
 */
const PATTERNS = {
  // Primary: HURMA_CANDIDATE_ID=12345 in description
  CANDIDATE_ID_DESCRIPTION: /HURMA_CANDIDATE_ID=(\d+)/i,

  // Secondary: CID:12345 in title or description
  CANDIDATE_ID_CID: /CID:(\d+)/i,
};

/**
 * Extracts the Hurma candidate ID from meeting description.
 * Looks for HURMA_CANDIDATE_ID=<id> pattern.
 *
 * @param {string} description
 * @returns {string|null}
 */
function extractCandidateIdFromDescription(description) {
  if (!description) return null;
  const match = description.match(PATTERNS.CANDIDATE_ID_DESCRIPTION);
  return match ? match[1] : null;
}

/**
 * Extracts the Hurma candidate ID from meeting title using CID:<id> format.
 *
 * @param {string} title
 * @returns {string|null}
 */
function extractCandidateIdFromTitle(title) {
  if (!title) return null;
  const match = title.match(PATTERNS.CANDIDATE_ID_CID);
  return match ? match[1] : null;
}

/**
 * Tries both description and title extraction.
 *
 * @param {string} description
 * @param {string} title
 * @returns {{ candidateId: string|null, matchedBy: string|null }}
 */
function parseCandidateId(description, title) {
  const fromDesc = extractCandidateIdFromDescription(description);
  if (fromDesc) return { candidateId: fromDesc, matchedBy: 'description_pattern' };

  const fromTitle = extractCandidateIdFromTitle(title);
  if (fromTitle) return { candidateId: fromTitle, matchedBy: 'title_cid_pattern' };

  return { candidateId: null, matchedBy: null };
}

module.exports = { parseCandidateId, extractCandidateIdFromDescription, extractCandidateIdFromTitle };
