/**
 * Summary service — compute daily_employee_summary rows.
 *
 * Called once per (employee, date) combination.
 * Reads from time_entries and absences tables; writes to daily_employee_summary.
 */
const db     = require('../db');
const config = require('../config');
const { getDayExpectation, toDateString } = require('../utils/workdays');
const logger = require('../utils/logger');

const THRESHOLD = config.OK_DELTA_THRESHOLD_HOURS;

/**
 * Compute and upsert the daily summary for a single (employee, date).
 *
 * @param {object} emp       Row from employees JOIN monitoring_settings
 * @param {string} dateStr   YYYY-MM-DD
 * @param {object[]} absences Array of absence rows for this employee (pre-fetched)
 * @param {Set<string>} holidaySet
 */
async function computeDaySummary(emp, dateStr, absences, holidaySet) {
  try {
    const hoursPerDay = parseFloat(emp.work_hours_per_day) || config.DEFAULT_WORK_HOURS_PER_DAY;

    // Absences covering this specific date
    const dayAbsences = absences.filter(
      (a) => toDateString(a.date_from) <= dateStr && toDateString(a.date_to) >= dateStr
    );

    const { expectedHours, leaveType } = getDayExpectation(
      dateStr, hoursPerDay, holidaySet, dayAbsences
    );

    // Sum actual logged hours from Redmine for this employee and date
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(hours), 0)::DECIMAL(6,2) AS actual_hours
       FROM time_entries
       WHERE employee_id = $1 AND entry_date = $2`,
      [emp.id, dateStr]
    );
    const actualHours = parseFloat(rows[0].actual_hours) || 0;

    const delta     = actualHours - expectedHours;
    const status    = resolveStatus(emp.monitoring_mode, emp.redmine_user_id, expectedHours, actualHours, delta, leaveType);
    const contrCount = await getContradictionCount(emp.id, dateStr);

    await db.query(
      `INSERT INTO daily_employee_summary
         (employee_id, summary_date, expected_hours, actual_hours, leave_type,
          contradiction_count, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (employee_id, summary_date) DO UPDATE SET
         expected_hours      = EXCLUDED.expected_hours,
         actual_hours        = EXCLUDED.actual_hours,
         leave_type          = EXCLUDED.leave_type,
         contradiction_count = EXCLUDED.contradiction_count,
         status              = EXCLUDED.status,
         updated_at          = NOW()`,
      [emp.id, dateStr, expectedHours, actualHours, leaveType, contrCount, status]
    );
  } catch (err) {
    logger.error({ err, employeeId: emp.id, dateStr }, 'computeDaySummary failed');
  }
}

function resolveStatus(monitoringMode, redmineUserId, expectedHours, actualHours, delta, leaveType) {
  if (monitoringMode === 'excluded' || monitoringMode === 'ignored_fulltime_external_project') {
    return 'EXCLUDED';
  }
  if (!redmineUserId) return 'UNMAPPED';

  if (leaveType && expectedHours === 0) {
    // Full leave day
    if (actualHours > 0) return 'CONTRADICTION';
    return 'ON_LEAVE';
  }

  if (Math.abs(delta) <= THRESHOLD) return 'OK';
  if (delta < -THRESHOLD)           return 'UNDERLOGGED';
  if (delta >  THRESHOLD)           return 'OVERLOGGED';
  return 'OK';
}

async function getContradictionCount(employeeId, dateStr) {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS cnt FROM contradictions
     WHERE employee_id = $1 AND contradiction_date = $2 AND is_resolved = false`,
    [employeeId, dateStr]
  );
  return parseInt(rows[0].cnt, 10);
}

/**
 * Return daily summary rows for all monitored employees for a given date.
 * @param {string} dateStr  YYYY-MM-DD
 * @param {object} filters  { onlyProblematic, onlyContradictions, monitoringMode }
 */
async function getDailySummary(dateStr, filters = {}) {
  let sql = `
    SELECT
      e.id             AS employee_id,
      e.full_name,
      e.email,
      e.department,
      s.monitoring_mode,
      e.redmine_user_id,
      COALESCE(d.expected_hours, 0)::DECIMAL(6,2)      AS expected_hours,
      COALESCE(d.actual_hours, 0)::DECIMAL(6,2)        AS actual_hours,
      COALESCE(d.delta_hours, 0)::DECIMAL(6,2)         AS delta_hours,
      d.leave_type,
      COALESCE(d.contradiction_count, 0)               AS contradiction_count,
      COALESCE(d.status, 'EXCLUDED')                   AS status,
      d.updated_at                                     AS last_synced
    FROM employees e
    JOIN employee_monitoring_settings s ON s.employee_id = e.id
    LEFT JOIN daily_employee_summary d ON d.employee_id = e.id AND d.summary_date = $1
    WHERE s.monitoring_mode = 'included'
  `;
  const params = [dateStr];

  if (filters.onlyProblematic) {
    sql += ` AND COALESCE(d.status, 'EXCLUDED') NOT IN ('OK','ON_LEAVE','EXCLUDED')`;
  }
  if (filters.onlyContradictions) {
    sql += ` AND COALESCE(d.contradiction_count, 0) > 0`;
  }

  sql += ' ORDER BY e.full_name';
  const { rows } = await db.query(sql, params);
  return rows;
}

/**
 * Return monthly aggregated summary for all monitored employees.
 * @param {string} yearMonth  YYYY-MM  (e.g. '2026-03')
 */
async function getMonthlySummary(yearMonth, filters = {}) {
  const [year, month] = yearMonth.split('-').map(Number);
  const from = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to   = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

  let sql = `
    SELECT
      e.id             AS employee_id,
      e.full_name,
      e.email,
      e.department,
      s.monitoring_mode,
      e.redmine_user_id,
      COALESCE(SUM(d.expected_hours), 0)::DECIMAL(8,2)  AS expected_hours,
      COALESCE(SUM(d.actual_hours), 0)::DECIMAL(8,2)    AS actual_hours,
      (COALESCE(SUM(d.actual_hours),0) - COALESCE(SUM(d.expected_hours),0))::DECIMAL(8,2)
                                                        AS delta_hours,
      COALESCE(SUM(d.contradiction_count), 0)           AS contradiction_count,
      MAX(d.status)                                     AS worst_status,
      COUNT(*) FILTER (WHERE d.status = 'OK')           AS ok_days,
      COUNT(*) FILTER (WHERE d.status = 'UNDERLOGGED')  AS underlogged_days,
      COUNT(*) FILTER (WHERE d.status = 'OVERLOGGED')   AS overlogged_days,
      COUNT(*) FILTER (WHERE d.leave_type IS NOT NULL)  AS leave_days
    FROM employees e
    JOIN employee_monitoring_settings s ON s.employee_id = e.id
    LEFT JOIN daily_employee_summary d ON d.employee_id = e.id
      AND d.summary_date >= $1 AND d.summary_date <= $2
    WHERE s.monitoring_mode = 'included'
    GROUP BY e.id, e.full_name, e.email, e.department, s.monitoring_mode, e.redmine_user_id
  `;
  const params = [from, to];

  if (filters.onlyProblematic) {
    sql += ` HAVING SUM(d.contradiction_count) > 0 OR
             SUM(d.actual_hours) < SUM(d.expected_hours) - $3`;
    params.push(config.OK_DELTA_THRESHOLD_HOURS * 5);
  }

  sql += ' ORDER BY e.full_name';
  const { rows } = await db.query(sql, params);
  return rows;
}

/**
 * Return day-by-day breakdown for a single employee over a date range.
 */
async function getEmployeeDetails(employeeId, from, to) {
  const { rows } = await db.query(
    `SELECT
       d.summary_date,
       d.expected_hours,
       d.actual_hours,
       d.delta_hours,
       d.leave_type,
       d.contradiction_count,
       d.status,
       d.notes
     FROM daily_employee_summary d
     WHERE d.employee_id = $1
       AND d.summary_date >= $2
       AND d.summary_date <= $3
     ORDER BY d.summary_date ASC`,
    [employeeId, from, to]
  );
  return rows;
}

module.exports = {
  computeDaySummary,
  getDailySummary,
  getMonthlySummary,
  getEmployeeDetails,
};
