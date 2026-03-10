/**
 * Sync service — orchestrates all data syncs between Hurma, Redmine, and the local DB.
 *
 * Sync pipeline:
 *   1. syncEmployees()     — pull employees from Hurma, pull users from Redmine, map them
 *   2. syncAbsences()      — pull absence records from Hurma for a date range
 *   3. syncTimeEntries()   — pull Redmine time entries for monitored employees
 *   4. recomputeSummaries()— recalculate daily_employee_summary + contradictions
 */
const db = require('../db');
const hurma = require('../clients/hurma');
const redmine = require('../clients/redmine');
const summaryService = require('./summary.service');
const contradictionService = require('./contradiction.service');
const { toDateString, eachDay, getUkrainianHolidays2025_2026 } = require('../utils/workdays');
const logger = require('../utils/logger');

// ── Sync run helpers ──────────────────────────────────────────────────────────

async function startRun(source, dateFrom, dateTo) {
  const { rows } = await db.query(
    `INSERT INTO sync_runs (source, date_range_from, date_range_to)
     VALUES ($1, $2, $3) RETURNING id`,
    [source, dateFrom || null, dateTo || null]
  );
  return rows[0].id;
}

async function finishRun(id, status, processed, errorMessage) {
  await db.query(
    `UPDATE sync_runs
     SET finished_at = NOW(), status = $1, records_processed = $2, error_message = $3
     WHERE id = $4`,
    [status, processed, errorMessage || null, id]
  );
}

// ── Employee sync ─────────────────────────────────────────────────────────────

/**
 * Sync Hurma employees → employees table + mapping.
 * Strategy: upsert on hurma_employee_id; attempt auto-mapping to Redmine by email/name.
 */
async function syncEmployees() {
  const runId = await startRun('hurma_employees', null, null);
  let processed = 0;
  try {
    const [hurmaEmployees, redmineUsers] = await Promise.all([
      hurma.getAllEmployees(),
      redmine.getAllUsers().catch((err) => {
        // Redmine /users.json needs admin key; degrade gracefully
        logger.warn({ err }, 'Could not fetch Redmine users — skipping Redmine mapping');
        return [];
      }),
    ]);

    // Index Redmine users by email and by "firstname lastname"
    const redmineByEmail = new Map();
    const redmineByName  = new Map();
    for (const u of redmineUsers) {
      if (u.mail)  redmineByEmail.set(u.mail.toLowerCase().trim(), u);
      const name = `${u.firstname} ${u.lastname}`.toLowerCase().trim();
      redmineByName.set(name, u);
    }

    for (const emp of hurmaEmployees) {
      const hurmaId   = String(emp.id || emp.employee_id || '');
      const fullName  = [emp.first_name, emp.last_name].filter(Boolean).join(' ')
                        || emp.full_name || emp.name || 'Unknown';
      const email     = (emp.email || emp.work_email || '').toLowerCase().trim();
      const dept      = emp.department?.name || emp.department || null;
      const position  = emp.position?.name  || emp.position   || null;
      const isActive  = emp.is_active ?? emp.active ?? true;

      // Auto-map to Redmine user
      let redmineUser = null;
      if (email) redmineUser = redmineByEmail.get(email) || null;
      if (!redmineUser) {
        redmineUser = redmineByName.get(fullName.toLowerCase().trim()) || null;
      }

      const { rows: existing } = await db.query(
        'SELECT id, redmine_user_id FROM employees WHERE hurma_employee_id = $1',
        [hurmaId]
      );

      if (existing.length === 0) {
        // Insert new employee
        const { rows } = await db.query(
          `INSERT INTO employees
             (hurma_employee_id, redmine_user_id, full_name, email,
              is_active, department, position, hurma_raw_json, redmine_raw_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [
            hurmaId,
            redmineUser?.id || null,
            fullName,
            email || null,
            isActive,
            dept,
            position,
            JSON.stringify(emp),
            redmineUser ? JSON.stringify(redmineUser) : null,
          ]
        );
        const empId = rows[0].id;

        // Create default monitoring settings (excluded by default)
        await db.query(
          `INSERT INTO employee_monitoring_settings (employee_id, monitoring_mode)
           VALUES ($1, 'excluded') ON CONFLICT (employee_id) DO NOTHING`,
          [empId]
        );

        // Add to mapping queue if no auto-match found
        if (!redmineUser) {
          await db.query(
            `INSERT INTO employee_mapping_queue
               (hurma_employee_id, hurma_full_name, hurma_email, status)
             VALUES ($1,$2,$3,'pending')
             ON CONFLICT DO NOTHING`,
            [hurmaId, fullName, email || null]
          );
        }
      } else {
        // Update existing; don't overwrite manual redmine_user_id if already set
        const existingRedmineId = existing[0].redmine_user_id;
        await db.query(
          `UPDATE employees SET
             full_name    = $1,
             email        = $2,
             is_active    = $3,
             department   = $4,
             position     = $5,
             hurma_raw_json = $6,
             redmine_user_id = COALESCE($7, redmine_user_id),
             updated_at   = NOW()
           WHERE hurma_employee_id = $8`,
          [
            fullName,
            email || null,
            isActive,
            dept,
            position,
            JSON.stringify(emp),
            existingRedmineId ? null : (redmineUser?.id || null),
            hurmaId,
          ]
        );
      }
      processed++;
    }

    // Seed public holidays if table is empty
    await seedHolidaysIfEmpty();

    await finishRun(runId, 'success', processed, null);
    logger.info({ processed }, 'syncEmployees complete');
    return { processed };
  } catch (err) {
    await finishRun(runId, 'failed', processed, err.message);
    logger.error({ err }, 'syncEmployees failed');
    throw err;
  }
}

// ── Absence sync ──────────────────────────────────────────────────────────────

/**
 * Sync absences from Hurma for the given date range into `absences` table.
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 */
async function syncAbsences(from, to) {
  const runId = await startRun('hurma_absences', from, to);
  let processed = 0;
  try {
    const rawAbsences = await hurma.getAllAbsences(from, to);

    for (const abs of rawAbsences) {
      const hurmaAbsenceId = String(abs.id || '');
      const hurmaEmployeeId = String(abs.employee_id || abs.employee?.id || '');

      const { rows: emp } = await db.query(
        'SELECT id FROM employees WHERE hurma_employee_id = $1',
        [hurmaEmployeeId]
      );
      if (emp.length === 0) {
        logger.warn({ hurmaEmployeeId }, 'Absence references unknown employee — skipping');
        continue;
      }
      const employeeId = emp[0].id;

      const absenceType = normalizeAbsenceType(abs.type || abs.absence_type || abs.kind || 'other');
      const dateFrom    = abs.date_from || abs.start_date || abs.from;
      const dateTo      = abs.date_to   || abs.end_date   || abs.to;
      const hours       = abs.hours != null ? parseFloat(abs.hours) : null;
      const isApproved  = abs.is_approved ?? abs.approved ?? true;

      await db.query(
        `INSERT INTO absences
           (employee_id, hurma_absence_id, absence_type, date_from, date_to, hours, is_approved, raw_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (hurma_absence_id) DO UPDATE SET
           absence_type = EXCLUDED.absence_type,
           date_from    = EXCLUDED.date_from,
           date_to      = EXCLUDED.date_to,
           hours        = EXCLUDED.hours,
           is_approved  = EXCLUDED.is_approved,
           raw_json     = EXCLUDED.raw_json,
           updated_at   = NOW()`,
        [employeeId, hurmaAbsenceId, absenceType, dateFrom, dateTo, hours, isApproved, JSON.stringify(abs)]
      );
      processed++;
    }

    await finishRun(runId, 'success', processed, null);
    logger.info({ from, to, processed }, 'syncAbsences complete');
    return { processed };
  } catch (err) {
    await finishRun(runId, 'failed', processed, err.message);
    logger.error({ err }, 'syncAbsences failed');
    throw err;
  }
}

/**
 * Map Hurma absence type strings to our canonical set.
 */
function normalizeAbsenceType(raw) {
  const s = String(raw).toLowerCase();
  if (s.includes('sick') || s.includes('illness')) return 'sick_leave';
  if (s.includes('vacat') || s.includes('annual')) return 'vacation';
  if (s.includes('unpaid') || s.includes('без оплат')) return 'unpaid_leave';
  if (s.includes('matern') || s.includes('декрет')) return 'maternity';
  return 'other';
}

// ── Time entries sync ─────────────────────────────────────────────────────────

/**
 * Sync Redmine time entries for all monitored employees.
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 */
async function syncTimeEntries(from, to) {
  const runId = await startRun('redmine_time_entries', from, to);
  let processed = 0;
  try {
    const { rows: monitored } = await db.query(
      `SELECT e.id AS employee_id, e.redmine_user_id
       FROM employees e
       JOIN employee_monitoring_settings s ON s.employee_id = e.id
       WHERE s.monitoring_mode = 'included'
         AND e.redmine_user_id IS NOT NULL
         AND e.is_active = true`
    );

    for (const row of monitored) {
      const entries = await redmine.getUserTimeEntries(row.redmine_user_id, from, to);
      for (const entry of entries) {
        const entryDate   = entry.spent_on;
        const hours       = parseFloat(entry.hours) || 0;
        const projectId   = entry.project?.id   || null;
        const projectName = entry.project?.name || null;
        const issueId     = entry.issue?.id     || null;
        const activity    = entry.activity?.name || null;
        const comments    = entry.comments || null;

        await db.query(
          `INSERT INTO time_entries
             (employee_id, redmine_entry_id, entry_date, hours, project_id, project_name,
              issue_id, activity_name, comments, raw_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (redmine_entry_id) DO UPDATE SET
             entry_date    = EXCLUDED.entry_date,
             hours         = EXCLUDED.hours,
             project_id    = EXCLUDED.project_id,
             project_name  = EXCLUDED.project_name,
             issue_id      = EXCLUDED.issue_id,
             activity_name = EXCLUDED.activity_name,
             comments      = EXCLUDED.comments,
             raw_json      = EXCLUDED.raw_json,
             updated_at    = NOW()`,
          [
            row.employee_id,
            entry.id,
            entryDate,
            hours,
            projectId,
            projectName,
            issueId,
            activity,
            comments,
            JSON.stringify(entry),
          ]
        );
        processed++;
      }
    }

    await finishRun(runId, 'success', processed, null);
    logger.info({ from, to, processed }, 'syncTimeEntries complete');
    return { processed };
  } catch (err) {
    await finishRun(runId, 'failed', processed, err.message);
    logger.error({ err }, 'syncTimeEntries failed');
    throw err;
  }
}

// ── Summary recomputation ─────────────────────────────────────────────────────

/**
 * Recompute daily summaries for all monitored employees over the given range.
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 */
async function recomputeSummaries(from, to) {
  const runId = await startRun('summary', from, to);
  let processed = 0;
  try {
    // Load public holidays
    const { rows: hRows } = await db.query('SELECT holiday_date FROM public_holidays');
    const holidaySet = new Set(hRows.map((r) => toDateString(r.holiday_date)));

    // All monitored employees
    const { rows: employees } = await db.query(
      `SELECT e.id, e.full_name, e.redmine_user_id, e.work_hours_per_day, s.monitoring_mode
       FROM employees e
       JOIN employee_monitoring_settings s ON s.employee_id = e.id
       WHERE s.monitoring_mode IN ('included', 'excluded', 'ignored_fulltime_external_project')`
    );

    for (const emp of employees) {
      // Absences for this employee in range
      const { rows: absences } = await db.query(
        `SELECT * FROM absences
         WHERE employee_id = $1 AND date_from <= $2 AND date_to >= $3`,
        [emp.id, to, from]
      );

      eachDay(from, to, async (dateStr) => {
        await summaryService.computeDaySummary(emp, dateStr, absences, holidaySet);
      });

      processed++;
    }

    // Run contradiction detection
    await contradictionService.detectContradictions(from, to);

    await finishRun(runId, 'success', processed, null);
    logger.info({ from, to, processed }, 'recomputeSummaries complete');
    return { processed };
  } catch (err) {
    await finishRun(runId, 'failed', processed, err.message);
    logger.error({ err }, 'recomputeSummaries failed');
    throw err;
  }
}

// ── Full sync ─────────────────────────────────────────────────────────────────

/**
 * Run a full sync: employees → absences → time entries → summaries.
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 */
async function runFullSync(from, to) {
  const runId = await startRun('all', from, to);
  try {
    await syncEmployees();
    await syncAbsences(from, to);
    await syncTimeEntries(from, to);
    await recomputeSummaries(from, to);
    await finishRun(runId, 'success', 0, null);
    logger.info({ from, to }, 'Full sync complete');
  } catch (err) {
    await finishRun(runId, 'failed', 0, err.message);
    logger.error({ err }, 'Full sync failed');
    throw err;
  }
}

// ── Holidays seeder ───────────────────────────────────────────────────────────

async function seedHolidaysIfEmpty() {
  const { rows } = await db.query('SELECT COUNT(*) AS cnt FROM public_holidays');
  if (parseInt(rows[0].cnt, 10) > 0) return;
  const holidays = getUkrainianHolidays2025_2026();
  for (const date of holidays) {
    await db.query(
      `INSERT INTO public_holidays (holiday_date, country_code) VALUES ($1, 'UA') ON CONFLICT DO NOTHING`,
      [date]
    );
  }
  logger.info({ count: holidays.length }, 'Seeded Ukrainian public holidays');
}

module.exports = {
  syncEmployees,
  syncAbsences,
  syncTimeEntries,
  recomputeSummaries,
  runFullSync,
};
