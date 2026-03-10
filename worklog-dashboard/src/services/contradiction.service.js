/**
 * Contradiction detection engine.
 *
 * Analyses the synced data for the given date range and writes rows to the
 * `contradictions` table.  Existing unresolved contradictions for the same
 * (employee, date, type) are replaced so the table stays idempotent.
 *
 * Contradiction types:
 *   LOGGED_ON_SICK_LEAVE            — time entry on a sick-leave day
 *   LOGGED_ON_VACATION              — time entry on a vacation day
 *   LOGGED_ON_UNPAID_LEAVE          — time entry on an unpaid-leave day
 *   LOGGED_ON_OTHER_LEAVE           — time entry on any other approved leave day
 *   NO_LOG_ON_WORKING_DAY           — no time entries on a normal working day
 *   PARTIAL_DAY_MISMATCH            — partial absence but logged hours diverge significantly
 *   HURMA_ONLY_NO_REDMINE_USER      — employee in Hurma but no Redmine mapping
 *   REDMINE_ONLY_NO_HURMA_MAPPING   — (detected via orphan time entries — future)
 *   EXCLUDED_BUT_HAS_WORKLOG_ACTIVITY — excluded employee still logging hours
 *   INCLUDED_BUT_NO_SYNCDATA        — included, mapped, but no time entries synced ever
 */
const db     = require('../db');
const config = require('../config');
const { isWeekend, isPublicHoliday, toDateString, eachDay } = require('../utils/workdays');
const logger = require('../utils/logger');

const THRESHOLD = config.OK_DELTA_THRESHOLD_HOURS;

/**
 * Detect and record contradictions for all relevant employees over the date range.
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 */
async function detectContradictions(from, to) {
  // Load public holidays
  const { rows: hRows } = await db.query('SELECT holiday_date FROM public_holidays');
  const holidaySet = new Set(hRows.map((r) => toDateString(r.holiday_date)));

  // All employees with a monitoring setting (any mode)
  const { rows: employees } = await db.query(
    `SELECT e.id, e.full_name, e.redmine_user_id, e.work_hours_per_day, s.monitoring_mode
     FROM employees e
     JOIN employee_monitoring_settings s ON s.employee_id = e.id`
  );

  for (const emp of employees) {
    await detectForEmployee(emp, from, to, holidaySet);
  }

  // Update contradiction_count in daily summaries
  await db.query(
    `UPDATE daily_employee_summary d SET
       contradiction_count = (
         SELECT COUNT(*) FROM contradictions c
         WHERE c.employee_id = d.employee_id
           AND c.contradiction_date = d.summary_date
           AND c.is_resolved = false
       ),
       status = CASE
         WHEN (
           SELECT COUNT(*) FROM contradictions c
           WHERE c.employee_id = d.employee_id
             AND c.contradiction_date = d.summary_date
             AND c.is_resolved = false
         ) > 0 THEN 'CONTRADICTION'
         ELSE d.status
       END
     WHERE d.summary_date >= $1 AND d.summary_date <= $2`,
    [from, to]
  );

  logger.info({ from, to }, 'Contradiction detection complete');
}

async function detectForEmployee(emp, from, to, holidaySet) {
  const hoursPerDay = parseFloat(emp.work_hours_per_day) || config.DEFAULT_WORK_HOURS_PER_DAY;

  // ── HURMA_ONLY_NO_REDMINE_USER ─────────────────────────────────────────────
  if (emp.monitoring_mode === 'included' && !emp.redmine_user_id) {
    await upsertContradiction({
      employeeId:        emp.id,
      date:              from,
      type:              'HURMA_ONLY_NO_REDMINE_USER',
      severity:          'MEDIUM',
      description:       `${emp.full_name} is included in monitoring but has no Redmine user mapping.`,
      absenceId:         null,
      timeEntryId:       null,
    });
    return; // Nothing else to check without a Redmine mapping
  }

  // Absences in range for this employee
  const { rows: absences } = await db.query(
    `SELECT * FROM absences
     WHERE employee_id = $1 AND date_from <= $2 AND date_to >= $3 AND is_approved = true`,
    [emp.id, to, from]
  );

  // Time entries in range for this employee
  const { rows: timeEntries } = await db.query(
    `SELECT id, entry_date, hours FROM time_entries
     WHERE employee_id = $1 AND entry_date >= $2 AND entry_date <= $3`,
    [emp.id, from, to]
  );

  // Index time entries by date
  const entriesByDate = new Map();
  for (const te of timeEntries) {
    const d = toDateString(te.entry_date);
    if (!entriesByDate.has(d)) entriesByDate.set(d, []);
    entriesByDate.get(d).push(te);
  }

  // ── EXCLUDED_BUT_HAS_WORKLOG_ACTIVITY ─────────────────────────────────────
  if (
    emp.monitoring_mode === 'excluded' ||
    emp.monitoring_mode === 'ignored_fulltime_external_project'
  ) {
    if (timeEntries.length > 0) {
      await upsertContradiction({
        employeeId:  emp.id,
        date:        from,
        type:        'EXCLUDED_BUT_HAS_WORKLOG_ACTIVITY',
        severity:    'LOW',
        description: `${emp.full_name} is excluded from monitoring but logged ${timeEntries.length} time entries between ${from} and ${to}.`,
      });
    }
    return;
  }

  if (emp.monitoring_mode !== 'included') return;

  // ── INCLUDED_BUT_NO_SYNCDATA ───────────────────────────────────────────────
  const workDays = [];
  eachDay(from, to, (d) => {
    if (!isWeekend(d) && !isPublicHoliday(d, holidaySet)) workDays.push(d);
  });

  if (workDays.length > 0 && timeEntries.length === 0) {
    // Only raise if it's not entirely covered by absences
    const fullyCoveredByLeave = workDays.every((d) =>
      absences.some((a) => toDateString(a.date_from) <= d && toDateString(a.date_to) >= d)
    );
    if (!fullyCoveredByLeave) {
      await upsertContradiction({
        employeeId:  emp.id,
        date:        from,
        type:        'INCLUDED_BUT_NO_SYNCDATA',
        severity:    'LOW',
        description: `${emp.full_name} is monitored but has zero Redmine time entries between ${from} and ${to}.`,
      });
    }
  }

  // ── Per-day checks ─────────────────────────────────────────────────────────
  for (const dateStr of workDays) {
    const dayEntries  = entriesByDate.get(dateStr) || [];
    const actualHours = dayEntries.reduce((s, te) => s + parseFloat(te.hours), 0);

    // Absences covering this date
    const dayAbsences = absences.filter(
      (a) => toDateString(a.date_from) <= dateStr && toDateString(a.date_to) >= dateStr
    );

    const firstAbsence = dayAbsences[0] || null;

    if (firstAbsence) {
      const absHours   = parseFloat(firstAbsence.hours) ?? hoursPerDay;
      const isFullDay  = absHours >= hoursPerDay;
      const absType    = firstAbsence.absence_type;

      if (isFullDay && actualHours > 0) {
        // Logged hours on a leave day
        const type = LEAVE_CONTRADICTION_TYPE[absType] || 'LOGGED_ON_OTHER_LEAVE';
        const severity = ['sick_leave','vacation','unpaid_leave'].includes(absType) ? 'HIGH' : 'MEDIUM';
        await upsertContradiction({
          employeeId:  emp.id,
          date:        dateStr,
          type,
          severity,
          description: `${emp.full_name} logged ${actualHours}h in Redmine on ${dateStr}, but is marked as ${absType} in Hurma.`,
          absenceId:   firstAbsence.id,
          timeEntryId: dayEntries[0]?.id || null,
        });
      } else if (!isFullDay) {
        // Partial absence — check mismatch
        const expectedReduced = Math.max(0, hoursPerDay - absHours);
        const delta = actualHours - expectedReduced;
        if (Math.abs(delta) > THRESHOLD * 2) {
          await upsertContradiction({
            employeeId:  emp.id,
            date:        dateStr,
            type:        'PARTIAL_DAY_MISMATCH',
            severity:    'MEDIUM',
            description: `${emp.full_name} has partial ${absType} (${absHours}h) on ${dateStr}. Expected ~${expectedReduced}h logged, actual ${actualHours}h (delta ${delta.toFixed(1)}h).`,
            absenceId:   firstAbsence.id,
            timeEntryId: dayEntries[0]?.id || null,
          });
        }
      }
    } else {
      // Normal working day — should have logs
      if (actualHours === 0) {
        await upsertContradiction({
          employeeId:  emp.id,
          date:        dateStr,
          type:        'NO_LOG_ON_WORKING_DAY',
          severity:    'MEDIUM',
          description: `${emp.full_name} has no Redmine time entries on ${dateStr} (normal working day).`,
        });
      }
    }
  }
}

const LEAVE_CONTRADICTION_TYPE = {
  sick_leave:   'LOGGED_ON_SICK_LEAVE',
  vacation:     'LOGGED_ON_VACATION',
  unpaid_leave: 'LOGGED_ON_UNPAID_LEAVE',
  maternity:    'LOGGED_ON_OTHER_LEAVE',
  other:        'LOGGED_ON_OTHER_LEAVE',
};

async function upsertContradiction({
  employeeId, date, type, severity, description, absenceId, timeEntryId,
}) {
  await db.query(
    `INSERT INTO contradictions
       (employee_id, contradiction_date, contradiction_type, severity, description,
        related_absence_id, related_time_entry_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [employeeId, date, type, severity, description, absenceId || null, timeEntryId || null]
  );
}

/**
 * Get contradictions with optional filters.
 */
async function getContradictions({ employeeId, from, to, type, severity, resolved = false } = {}) {
  let sql = `
    SELECT c.*, e.full_name
    FROM contradictions c
    JOIN employees e ON e.id = c.employee_id
    WHERE c.is_resolved = $1
  `;
  const params = [resolved];
  let idx = 2;
  if (employeeId) { sql += ` AND c.employee_id = $${idx++}`; params.push(employeeId); }
  if (from)       { sql += ` AND c.contradiction_date >= $${idx++}`; params.push(from); }
  if (to)         { sql += ` AND c.contradiction_date <= $${idx++}`; params.push(to); }
  if (type)       { sql += ` AND c.contradiction_type = $${idx++}`; params.push(type); }
  if (severity)   { sql += ` AND c.severity = $${idx++}`; params.push(severity); }
  sql += ' ORDER BY c.contradiction_date DESC, c.severity DESC';

  const { rows } = await db.query(sql, params);
  return rows;
}

module.exports = {
  detectContradictions,
  getContradictions,
};
