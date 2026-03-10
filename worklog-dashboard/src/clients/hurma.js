/**
 * Hurma HR API client.
 *
 * Hurma exposes two API versions accessible at https://swagger-ui.hurma.work/:
 *  - Public API v1  → HR module: employees, absences, work schedules
 *  - Public API v3  → ATS module: candidates, vacancies (used by parent project)
 *
 * IMPORTANT: Verify the exact endpoint paths against your Hurma instance at
 * https://swagger-ui.hurma.work/ before going to production.
 * Set HURMA_HR_API_VERSION=v1 (default) in .env to use /api/v1/* endpoints.
 * If your plan only exposes v3, set HURMA_HR_API_VERSION=v3.
 *
 * All requests use: Authorization: Bearer <HURMA_API_TOKEN>
 */
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

function getClient() {
  return axios.create({
    baseURL: config.HURMA_BASE_URL.replace(/\/$/, ''),
    headers: {
      Authorization: `Bearer ${config.HURMA_API_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: 30_000,
  });
}

const v = config.HURMA_HR_API_VERSION; // 'v1' or 'v3'

/**
 * Fetch paginated employee list from Hurma.
 * Endpoint: GET /api/{v}/employees
 *
 * @param {object} opts
 * @param {number} [opts.page=1]
 * @param {number} [opts.perPage=100]
 * @returns {Promise<{ employees: any[], total: number, page: number, perPage: number }>}
 */
async function getEmployees({ page = 1, perPage = 100 } = {}) {
  try {
    const { data } = await getClient().get(`/api/${v}/employees`, {
      params: { page, per_page: perPage },
    });
    // Hurma wraps arrays; handle both { employees: [...], total: N } and plain arrays.
    if (Array.isArray(data)) {
      return { employees: data, total: data.length, page, perPage };
    }
    return {
      employees: data.employees || data.data || [],
      total:     data.total    || data.meta?.total || 0,
      page,
      perPage,
    };
  } catch (err) {
    logger.error({ err, endpoint: `/api/${v}/employees` }, 'Hurma getEmployees failed');
    throw err;
  }
}

/**
 * Fetch all employees by paging through until exhausted.
 * @returns {Promise<any[]>}
 */
async function getAllEmployees() {
  const all = [];
  let page = 1;
  while (true) {
    const { employees, total, perPage } = await getEmployees({ page, perPage: 100 });
    all.push(...employees);
    if (all.length >= total || employees.length === 0) break;
    page++;
  }
  return all;
}

/**
 * Fetch a single employee by Hurma employee ID.
 * Endpoint: GET /api/{v}/employees/{id}
 * @param {string|number} id
 */
async function getEmployee(id) {
  try {
    const { data } = await getClient().get(`/api/${v}/employees/${id}`);
    return data.employee || data;
  } catch (err) {
    if (err.response?.status === 404) return null;
    logger.error({ err, id }, 'Hurma getEmployee failed');
    throw err;
  }
}

/**
 * Fetch absence / leave records in a date range.
 * Endpoint: GET /api/{v}/absences
 *
 * Known query params (verify against swagger):
 *   from       YYYY-MM-DD
 *   to         YYYY-MM-DD
 *   page       integer
 *   per_page   integer
 *
 * @param {object} opts
 * @param {string} opts.from  YYYY-MM-DD
 * @param {string} opts.to    YYYY-MM-DD
 * @param {number} [opts.page=1]
 * @param {number} [opts.perPage=100]
 * @param {string|number} [opts.employeeId]  Optional — filter by single employee
 */
async function getAbsences({ from, to, page = 1, perPage = 100, employeeId } = {}) {
  const params = { from, to, page, per_page: perPage };
  if (employeeId) params.employee_id = employeeId;
  try {
    const { data } = await getClient().get(`/api/${v}/absences`, { params });
    if (Array.isArray(data)) {
      return { absences: data, total: data.length, page, perPage };
    }
    return {
      absences: data.absences || data.data || [],
      total:    data.total    || data.meta?.total || 0,
      page,
      perPage,
    };
  } catch (err) {
    logger.error({ err, from, to }, 'Hurma getAbsences failed');
    throw err;
  }
}

/**
 * Fetch all absences in date range by paging through.
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 * @returns {Promise<any[]>}
 */
async function getAllAbsences(from, to) {
  const all = [];
  let page = 1;
  while (true) {
    const { absences, total, perPage } = await getAbsences({ from, to, page, perPage: 100 });
    all.push(...absences);
    if (all.length >= total || absences.length === 0) break;
    page++;
  }
  return all;
}

/**
 * Validate that the Hurma API token is working.
 * Tries a minimal call; returns true/false.
 */
async function validateToken() {
  try {
    await getClient().get(`/api/${v}/employees`, { params: { page: 1, per_page: 1 } });
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  getEmployees,
  getAllEmployees,
  getEmployee,
  getAbsences,
  getAllAbsences,
  validateToken,
};
