'use strict';

/**
 * Hurma Recruitment API client.
 *
 * Authentication: Hurma v3 API uses OAuth2 (password grant).
 * Flow:
 *   1. POST /oauth/token with grant_type=client_credentials + client_id + client_secret
 *   2. Get access_token (expires in 3600s) + refresh_token
 *   3. On expiry, use refresh_token to get a new access_token
 *   4. Tokens are stored per-user in the DB
 *
 * To set up OAuth for a user, call setupOAuth(userId, email, password).
 * After that, all API calls auto-manage token refresh.
 */

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const db = require('../db');

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

/**
 * Exchange credentials for OAuth tokens using password grant.
 */
async function fetchTokensWithClientCredentials() {
  try {
    const res = await axios.post(
      `${config.HURMA_BASE_URL}/oauth/token`,
      {
        grant_type: 'client_credentials',
        client_id: String(config.HURMA_OAUTH_CLIENT_ID),
        client_secret: config.HURMA_OAUTH_CLIENT_SECRET,
      },
      { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 15000 },
    );
    return res.data;
  } catch (err) {
    const body = err.response?.data;
    logger.error(
      { status: err.response?.status, body: JSON.stringify(body) },
      'Hurma OAuth client_credentials grant failed',
    );
    throw new Error(
      `Hurma OAuth error ${err.response?.status}: ${JSON.stringify(body)}`,
    );
  }
}

/**
 * Exchange a refresh token for a new access token.
 */
async function fetchTokensWithRefresh(refreshToken) {
  const res = await axios.post(
    `${config.HURMA_BASE_URL}/oauth/token`,
    {
      grant_type: 'refresh_token',
      client_id: String(config.HURMA_OAUTH_CLIENT_ID),
      client_secret: config.HURMA_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
    },
    { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 15000 },
  );
  return res.data;
}

/**
 * Persist OAuth tokens for a user in the DB.
 */
async function saveTokens(userId, tokenData) {
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
  await db.query(
    `UPDATE users
     SET hurma_oauth_access_token    = $1,
         hurma_oauth_refresh_token   = $2,
         hurma_oauth_token_expires_at = $3
     WHERE id = $4`,
    [tokenData.access_token, tokenData.refresh_token, expiresAt, userId],
  );
  return { accessToken: tokenData.access_token, expiresAt };
}

/**
 * One-time OAuth setup for a user.
 * Uses client_credentials grant (Hurma "API" type client).
 *
 * @param {number} userId
 * @returns {Promise<void>}
 */
async function setupOAuth(userId) {
  logger.info({ userId }, 'Setting up Hurma OAuth tokens');
  const tokenData = await fetchTokensWithClientCredentials();
  // client_credentials tokens don't have a refresh_token — re-fetch on expiry
  if (!tokenData.refresh_token) {
    tokenData.refresh_token = null;
  }
  await saveTokens(userId, tokenData);
  logger.info({ userId }, 'Hurma OAuth tokens saved');
}

/**
 * Get a valid access token for the user. Auto-refreshes if expired.
 * Updates the DB in place if refresh happens.
 *
 * @param {object} user - User row from DB (must include oauth fields)
 * @returns {Promise<string>} Bearer JWT access token
 */
async function getValidAccessToken(user) {
  if (!user) throw new Error('No user provided for Hurma OAuth');

  const { hurma_oauth_access_token, hurma_oauth_refresh_token, hurma_oauth_token_expires_at } = user;

  // Check if current token is still valid
  if (hurma_oauth_access_token && hurma_oauth_token_expires_at) {
    const expiresAt = new Date(hurma_oauth_token_expires_at);
    if (expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
      return hurma_oauth_access_token;
    }
  }

  // Refresh using refresh_token if available
  if (hurma_oauth_refresh_token) {
    logger.info({ userId: user.id }, 'Refreshing Hurma OAuth access token');
    try {
      const tokenData = await fetchTokensWithRefresh(hurma_oauth_refresh_token);
      const { accessToken } = await saveTokens(user.id, tokenData);
      return accessToken;
    } catch (err) {
      logger.warn({ userId: user.id, err: err.message }, 'Hurma OAuth refresh failed — retrying with client_credentials');
    }
  }

  // client_credentials grant: re-fetch access token (no refresh token for this grant type)
  if (config.HURMA_OAUTH_CLIENT_ID && config.HURMA_OAUTH_CLIENT_SECRET) {
    logger.info({ userId: user.id }, 'Fetching new Hurma OAuth token via client_credentials');
    const tokenData = await fetchTokensWithClientCredentials();
    if (!tokenData.refresh_token) tokenData.refresh_token = null;
    const { accessToken } = await saveTokens(user.id, tokenData);
    return accessToken;
  }

  throw new Error(
    'No Hurma OAuth tokens configured. Set HURMA_OAUTH_CLIENT_ID and HURMA_OAUTH_CLIENT_SECRET in .env, then call POST /api/users/hurma-oauth',
  );
}

/**
 * Build an axios client using a valid OAuth JWT.
 *
 * @param {object} user - User row from DB
 * @returns {Promise<AxiosInstance>}
 */
async function buildClient(user) {
  const token = await getValidAccessToken(user);
  return axios.create({
    baseURL: config.HURMA_BASE_URL,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: 20000,
  });
}

/**
 * Verify a candidate exists in Hurma.
 *
 * @param {string} candidateId
 * @param {object} user - User row from DB
 */
async function getCandidateById(candidateId, user) {
  const client = await buildClient(user);
  logger.info({ candidateId }, 'Looking up Hurma candidate');

  try {
    const response = await client.get(`/api/v3/candidates/${encodeURIComponent(candidateId)}`);
    return response.data?.data || null;
  } catch (err) {
    if (err.response?.status === 404) {
      logger.warn({ candidateId }, 'Hurma candidate not found');
      return null;
    }
    logger.error({ candidateId, status: err.response?.status, message: err.message }, 'Hurma getCandidateById error');
    throw err;
  }
}

/**
 * Search for a candidate by email address.
 *
 * @param {string} email
 * @param {object} user - User row from DB
 */
async function findCandidateByEmail(email, user) {
  const client = await buildClient(user);
  logger.info({ email }, 'Searching Hurma candidate by email');

  try {
    const response = await client.get('/api/v3/candidates', {
      params: { 'filter[email]': email, per_page: 1 },
    });
    const items = response.data?.data || [];
    return items.length > 0 ? items[0] : null;
  } catch (err) {
    logger.error({ email, status: err.response?.status, message: err.message }, 'Hurma findCandidateByEmail error');
    throw err;
  }
}

/**
 * Search for a candidate by full name.
 *
 * @param {string} name
 * @param {object} user - User row from DB
 */
async function findCandidateByName(name, user) {
  const client = await buildClient(user);
  logger.info({ name }, 'Searching Hurma candidate by name');

  try {
    const response = await client.get('/api/v3/candidates', {
      params: { 'filter[name]': name, per_page: 5 },
    });
    const items = response.data?.data || [];
    if (!items.length) return null;

    const normalizedQuery = name.toLowerCase().trim();
    const exact = items.find((c) => {
      const full = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase().trim();
      return full === normalizedQuery;
    });
    return exact || items[0];
  } catch (err) {
    logger.error({ name, status: err.response?.status, message: err.message }, 'Hurma findCandidateByName error');
    throw err;
  }
}

/**
 * Create a comment on a candidate record in Hurma.
 *
 * @param {string} candidateId
 * @param {string} commentText
 * @param {object} user - User row from DB
 */
async function createCandidateComment(candidateId, commentText, user) {
  const client = await buildClient(user);
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
    logger.error({ candidateId, status, body, message: err.message }, 'Hurma createCandidateComment error');
    throw err;
  }
}

module.exports = {
  setupOAuth,
  getCandidateById,
  findCandidateByEmail,
  findCandidateByName,
  createCandidateComment,
};
