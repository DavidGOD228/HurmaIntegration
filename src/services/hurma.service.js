'use strict';

/**
 * Hurma Recruitment API client.
 *
 * Confirmed endpoints from https://swagger-ui.hurma.work/ (Public API v3):
 *
 *   GET  /api/v3/candidates                    List / search candidates
 *                                              Supports filter[email], filter[name]
 *
 *   GET  /api/v3/candidates/{id}               Get one candidate by encoded ID
 *
 *   POST /api/v3/candidates/{id}/comments      Create a candidate comment
 *                                              Body: { comment: "text" }
 *                                              Response: { id: <integer> }
 *
 * Authentication: Bearer token via Authorization header.
 * Base URL is tenant-specific (configured in HURMA_BASE_URL env var).
 * All endpoints require ATS PRO subscription.
 *
 * NOTE: Candidate IDs in Hurma are alphanumeric-encoded strings (e.g., "Je"),
 * not plain integers. The HURMA_CANDIDATE_ID embedded in meeting metadata
 * must match this Hurma encoded format.
 *
 * TODO: If Hurma exposes a recruitment-stage update endpoint in a future API
 * version, add it as `updateCandidateStage()` here. Not found in current Swagger.
 */

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

function buildClient() {
  return axios.create({
    baseURL: config.HURMA_BASE_URL,
    headers: {
      Authorization: `Bearer ${config.HURMA_API_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: 20000,
  });
}

/**
 * Verify a candidate exists in Hurma.
 *
 * @param {string} candidateId - Hurma alphanumeric candidate ID
 * @returns {Promise<object|null>} Candidate data or null if not found
 */
async function getCandidateById(candidateId) {
  const client = buildClient();

  logger.info({ candidateId }, 'Looking up Hurma candidate');

  try {
    const response = await client.get(`/api/v3/candidates/${encodeURIComponent(candidateId)}`);
    return response.data?.data || null;
  } catch (err) {
    if (err.response?.status === 404) {
      logger.warn({ candidateId }, 'Hurma candidate not found');
      return null;
    }
    logger.error(
      { candidateId, status: err.response?.status, message: err.message },
      'Hurma getCandidateById error',
    );
    throw err;
  }
}

/**
 * Search for a candidate by email address.
 * Used as a last-resort fallback when no candidate ID is found in meeting metadata.
 *
 * @param {string} email
 * @returns {Promise<object|null>} First matching candidate or null
 */
async function findCandidateByEmail(email) {
  const client = buildClient();

  logger.info({ email }, 'Searching Hurma candidate by email');

  try {
    const response = await client.get('/api/v3/candidates', {
      params: { 'filter[email]': email, per_page: 1 },
    });

    const items = response.data?.data || [];
    return items.length > 0 ? items[0] : null;
  } catch (err) {
    logger.error(
      { email, status: err.response?.status, message: err.message },
      'Hurma findCandidateByEmail error',
    );
    throw err;
  }
}

/**
 * Create a comment on a candidate record in Hurma.
 *
 * Endpoint: POST /api/v3/candidates/{id}/comments
 * Body:     { comment: "..." }
 * Response: { id: <integer> }
 *
 * @param {string} candidateId  - Hurma candidate encoded ID
 * @param {string} commentText  - Plain text content of the comment
 * @returns {Promise<{id: number}>}
 */
async function createCandidateComment(candidateId, commentText) {
  const client = buildClient();

  logger.info({ candidateId }, 'Creating Hurma candidate comment');

  try {
    const response = await client.post(
      `/api/v3/candidates/${encodeURIComponent(candidateId)}/comments`,
      { comment: commentText },
    );

    const noteId = response.data?.id;
    logger.info({ candidateId, noteId }, 'Hurma candidate comment created');
    return response.data;
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    logger.error(
      { candidateId, status, body, message: err.message },
      'Hurma createCandidateComment error',
    );
    throw err;
  }
}

module.exports = { getCandidateById, findCandidateByEmail, createCandidateComment };
