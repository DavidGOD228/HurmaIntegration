'use strict';

/**
 * Regex patterns used to extract Hurma candidate IDs from meeting metadata.
 *
 * Important: Hurma candidate IDs are alphanumeric strings (e.g. "Je", "Ab3"),
 * NOT plain integers — patterns must use [A-Za-z0-9]+ not \d+.
 *
 * Priority order matches the business specification.
 */
const PATTERNS = {
  // Primary: HURMA_CANDIDATE_ID=Je  (or any alphanumeric ID)
  CANDIDATE_ID_DESCRIPTION: /HURMA_CANDIDATE_ID=([A-Za-z0-9]+)/i,

  // Secondary: CID:Je in title or description
  CANDIDATE_ID_CID: /CID:([A-Za-z0-9]+)/i,

  // Extract a human name from common meeting title formats:
  //   "Interview with John Smith"   → "John Smith"
  //   "John Smith - Final Interview"→ "John Smith"
  //   "Call | John Smith"           → "John Smith"
  INTERVIEW_TITLE_NAME: [
    /interview(?:\s+with)?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[-–|]/,
    /[-–|]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,
  ],
};

/**
 * Extracts the Hurma candidate ID from meeting description.
 */
function extractCandidateIdFromDescription(description) {
  if (!description) return null;
  const match = description.match(PATTERNS.CANDIDATE_ID_DESCRIPTION);
  return match ? match[1] : null;
}

/**
 * Extracts the Hurma candidate ID from meeting title using CID:<id> format.
 */
function extractCandidateIdFromTitle(title) {
  if (!title) return null;
  const match = title.match(PATTERNS.CANDIDATE_ID_CID);
  return match ? match[1] : null;
}

/**
 * Tries to extract a candidate full name from the meeting title.
 * Returns null if no clear name pattern is detected.
 *
 * @param {string} title
 * @returns {string|null}
 */
function extractNameFromTitle(title) {
  if (!title) return null;
  for (const pattern of PATTERNS.INTERVIEW_TITLE_NAME) {
    const match = title.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Tries both description and title ID extraction.
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

module.exports = {
  parseCandidateId,
  extractCandidateIdFromDescription,
  extractCandidateIdFromTitle,
  extractNameFromTitle,
};
