/**
 * Redmine REST API client — https://project.mirko.in.ua/
 * Auth: X-Redmine-API-Key header (see https://www.redmine.org/projects/redmine/wiki/rest_api)
 *
 * Used endpoints:
 *   GET /users.json          — list all users (requires admin key)
 *   GET /users/current.json  — validate API key
 *   GET /time_entries.json   — list time entries with user_id / date filters
 */
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

function getClient() {
  return axios.create({
    baseURL: config.REDMINE_BASE_URL.replace(/\/$/, ''),
    headers: {
      'X-Redmine-API-Key': config.REDMINE_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: 30_000,
  });
}

/**
 * Validate API key and return current Redmine user.
 * @returns {Promise<object>}
 */
async function getCurrentUser() {
  const { data } = await getClient().get('/my/account.json');
  return data.user;
}

/**
 * Fetch all Redmine users (requires admin API key).
 * Paginates automatically until exhausted.
 * @param {object} [opts]
 * @param {number} [opts.status=1]  1=active, 2=registered, 3=locked, empty=all
 * @returns {Promise<any[]>}
 */
async function getAllUsers({ status = 1 } = {}) {
  const all = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const { data } = await getClient().get('/users.json', {
      params: { limit, offset, status },
    });
    const users = data.users || [];
    all.push(...users);
    const total = data.total_count ?? users.length;
    offset += limit;
    if (all.length >= total || users.length === 0) break;
  }
  return all;
}

/**
 * Fetch time entries with optional filters.
 * Paginates automatically.
 *
 * @param {object} opts
 * @param {number}  [opts.userId]     Redmine user_id
 * @param {string}  [opts.from]       YYYY-MM-DD
 * @param {string}  [opts.to]         YYYY-MM-DD
 * @param {number}  [opts.projectId]
 * @param {number}  [opts.limit=100]  Max 100 per request (Redmine cap)
 * @returns {Promise<any[]>}
 */
async function getTimeEntries({ userId, from, to, projectId } = {}) {
  const all = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const params = { limit, offset };
    if (userId)    params.user_id    = userId;
    if (from)      params.from       = from;
    if (to)        params.to         = to;
    if (projectId) params.project_id = projectId;

    const { data } = await getClient().get('/time_entries.json', { params });
    const entries = data.time_entries || [];
    all.push(...entries);
    const total = data.total_count ?? entries.length;
    offset += limit;
    if (all.length >= total || entries.length === 0) break;
  }
  return all;
}

/**
 * Fetch time entries for a single user in a date range.
 * Convenience wrapper around getTimeEntries.
 * @param {number} userId
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 */
async function getUserTimeEntries(userId, from, to) {
  try {
    return await getTimeEntries({ userId, from, to });
  } catch (err) {
    logger.error({ err, userId, from, to }, 'Redmine getUserTimeEntries failed');
    throw err;
  }
}

/**
 * Validate that the Redmine API key has at least read access.
 * Returns true/false.
 */
async function validateKey() {
  try {
    await getClient().get('/my/account.json');
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  getCurrentUser,
  getAllUsers,
  getTimeEntries,
  getUserTimeEntries,
  validateKey,
};
