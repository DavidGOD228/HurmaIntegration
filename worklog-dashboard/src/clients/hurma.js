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
 * Public API v1 expects header: token (not Authorization: Bearer)
 * See https://swagger-ui.hurma.work/#/Employees/1dce49c8aac6c9a42fcfcc681935049d
 */
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

function getClient() {
  return axios.create({
    baseURL: config.HURMA_BASE_URL.replace(/\/$/, ''),
    headers: {
      token: config.HURMA_API_TOKEN,
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
 * Hurma v1 status param: 7=probation only, 8=current+fired, 9=current only (incl. probation)
 *
 * @param {object} opts
 * @param {number} [opts.page=1]
 * @param {number} [opts.perPage=100]
 * @param {number} [opts.status=9]  v1 only: 9=current employees (excl. fired)
 * @returns {Promise<{ employees: any[], total: number, page: number, perPage: number }>}
 */
async function getEmployees({ page = 1, perPage = 100, status = 9 } = {}) {
  try {
    const params = { page, per_page: perPage };
    if (v === 'v1' && status != null) params.status = status;
    const { data } = await getClient().get(`/api/${v}/employees`, {
      params,
    });
    // Hurma v1 wraps as { result: { data: [...], current_page, total } }; v3 may differ.
    if (Array.isArray(data)) {
      return { employees: data, total: data.length, page, perPage };
    }
    const result = data.result || data;
    const employees = result.data || data.employees || data.data || [];
    const total = result.total ?? data.total ?? data.meta?.total ?? employees.length;
    return {
      employees,
      total: typeof total === 'number' ? total : employees.length,
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
    const result = data.result || data;
    const absences = result.data || data.absences || data.data || [];
    const total = result.total ?? data.total ?? data.meta?.total ?? absences.length;
    return {
      absences,
      total: typeof total === 'number' ? total : absences.length,
      page,
      perPage,
    };
  } catch (err) {
    // v1 may not expose /absences; rethrow so getAllAbsences can fall back to /out-off-office
    if (err.response?.status === 404) {
      logger.warn({ from, to }, 'Hurma /absences not found (v1 uses /out-off-office)');
    }
    throw err;
  }
}

/**
 * Fetch all absences in date range by paging through.
 * Tries GET /api/{v}/absences first. For Hurma v1 (no /absences), falls back to
 * GET /out-off-office which returns per-employee absence arrays (vacation, sick_leave, etc).
 *
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 * @returns {Promise<any[]>} Array of { employee_id, absence_type, date_from, date_to, hours }
 */
async function getAllAbsences(from, to) {
  try {
    const all = [];
    let page = 1;
    while (true) {
      const { absences, total, perPage } = await getAbsences({ from, to, page, perPage: 100 });
      all.push(...absences);
      if (all.length >= total || absences.length === 0) break;
      page++;
    }
    return all;
  } catch (err) {
    if (err.response?.status === 404 && v === 'v1') {
      logger.info('Hurma v1 /absences not found, using /out-off-office');
      return getAbsencesFromOutOfOffice(from, to);
    }
    throw err;
  }
}

/**
 * Hurma v1: fetch absences via GET /out-off-office.
 * Response: { result: { data: [{ id, name, email, vacation: [...], sick_leave: [...], ... }] } }
 * Each array contains date strings (YYYY-MM-DD or DD.MM.YYYY).
 *
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 * @returns {Promise<any[]>}
 */
async function getAbsencesFromOutOfOffice(from, to) {
  const typeToAbsence = {
    vacation: 'vacation',
    sick_leave: 'sick_leave',
    documented_sick_leave: 'sick_leave',
    unpaid_vacation: 'unpaid_leave',
    business_trip: 'other',
    home_work: 'other',
    overtime: 'other',
    weekend_work: 'other',
    night_shift: 'other',
  };
  const all = [];
  let page = 1;
  const fromDate = new Date(from);
  const toDate = new Date(to);

  while (true) {
    const { data } = await getClient().get(`/api/${v}/out-off-office`, {
      params: { status: 9, page, per_page: 100 },
    });
    const result = data.result || data;
    const items = result.data || data.data || [];
    if (items.length === 0) break;

    for (const emp of items) {
      const hurmaEmployeeId = String(emp.id || '');
      for (const [key, absenceType] of Object.entries(typeToAbsence)) {
        const dates = emp[key];
        if (!Array.isArray(dates)) continue;
        for (const d of dates) {
          let dateStr = d;
          if (typeof d === 'object' && d != null && d.date) {
            dateStr = d.date;
          }
          if (typeof dateStr !== 'string') continue;
          // Normalize date: DD.MM.YYYY or YYYY-MM-DD
          const parsed = parseHurmaDate(dateStr);
          if (!parsed) continue;
          const dObj = new Date(parsed);
          if (dObj >= fromDate && dObj <= toDate) {
            all.push({
              employee_id: hurmaEmployeeId,
              absence_type: absenceType,
              date_from: parsed,
              date_to: parsed,
              hours: 8,
            });
          }
        }
      }
    }

    const total = result.total ?? data.total ?? items.length;
    if (page * 100 >= total || items.length === 0) break;
    page++;
  }
  return all;
}

function parseHurmaDate(s) {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim();
  // YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD.MM.YYYY
  const eu = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(trimmed);
  if (eu) {
    const [, day, month, year] = eu;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
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
