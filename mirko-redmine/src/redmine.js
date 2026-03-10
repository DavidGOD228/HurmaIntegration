/**
 * Redmine REST API client for https://project.mirko.in.ua/
 * Auth: X-Redmine-API-Key header (see https://www.redmine.org/projects/redmine/wiki/rest_api)
 */

const axios = require('axios');

const baseURL = process.env.REDMINE_BASE_URL || 'https://project.mirko.in.ua';
const apiKey = process.env.REDMINE_API_KEY || '';

function getClient() {
  if (!apiKey) {
    throw new Error('REDMINE_API_KEY is required');
  }
  return axios.create({
    baseURL: baseURL.replace(/\/$/, ''),
    headers: {
      'X-Redmine-API-Key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
}

/**
 * GET /issues.json — list issues (with optional project_id, limit, offset)
 */
async function getIssues(options = {}) {
  const { projectId, limit = 25, offset = 0, statusId, trackerId } = options;
  const params = { limit, offset };
  if (projectId) params.project_id = projectId;
  if (statusId) params.status_id = statusId;
  if (trackerId) params.tracker_id = trackerId;
  const { data } = await getClient().get('/issues.json', { params });
  return data;
}

/**
 * GET /issues/:id.json — get one issue
 */
async function getIssue(id, include = []) {
  const params = include.length ? { include: include.join(',') } : {};
  const { data } = await getClient().get(`/issues/${id}.json`, { params });
  return data.issue;
}

/**
 * POST /issues.json — create issue
 */
async function createIssue(issue) {
  const { data } = await getClient().post('/issues.json', { issue });
  return data.issue;
}

/**
 * PUT /issues/:id.json — update issue
 */
async function updateIssue(id, issue) {
  const { data } = await getClient().put(`/issues/${id}.json`, { issue });
  return data.issue;
}

/**
 * GET /projects.json — list projects
 */
async function getProjects(options = {}) {
  const { limit = 25, offset = 0 } = options;
  const { data } = await getClient().get('/projects.json', {
    params: { limit, offset },
  });
  return data;
}

/**
 * GET /my/account.json — current user (validates API key)
 */
async function getCurrentUser() {
  const { data } = await getClient().get('/my/account.json');
  return data.user;
}

module.exports = {
  getClient,
  getIssues,
  getIssue,
  createIssue,
  updateIssue,
  getProjects,
  getCurrentUser,
};
