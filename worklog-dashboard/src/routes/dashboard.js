const express = require('express');
const { z }   = require('zod');
const summaryService = require('../services/summary.service');
const contradictionService = require('../services/contradiction.service');
const db = require('../db');
const logger = require('../utils/logger');
const { toDateString } = require('../utils/workdays');

const router = express.Router();

/** Map canonical absence_type to display label for table and "Leave in period". */
function getLeaveTypeDisplayLabel(type) {
  if (!type) return '';
  const t = String(type).toLowerCase();
  if (t === 'sick_leave') return 'Sick Leave';
  if (t === 'vacation') return 'Vacation';
  if (t === 'unpaid_leave') return 'Unpaid Leave';
  if (t === 'maternity') return 'Maternity Leave';
  if (t === 'other') return 'Leave';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// GET /api/dashboard/daily?date=YYYY-MM-DD&onlyProblematic=1&onlyContradictions=1
router.get('/daily', async (req, res, next) => {
  try {
    const date = toDateString(req.query.date) || req.query.date || toDateString(new Date());
    const filters = {
      onlyProblematic:    req.query.onlyProblematic === '1' || req.query.onlyProblematic === 'true',
      onlyContradictions: req.query.onlyContradictions === '1' || req.query.onlyContradictions === 'true',
    };
    // Ensure summaries (and contradiction counts) exist for this date for all included employees
    await summaryService.ensureSummariesForDate(date);
    const rows = await summaryService.getDailySummary(date, filters);

    // Totals (ensure numbers for frontend)
    const contradictionsCount = rows.filter((r) => r.status === 'CONTRADICTION').length;
    const totalConflictIssues = rows.reduce((s, r) => s + (parseInt(r.contradiction_count, 10) || 0), 0);
    const totals = {
      monitored:     rows.length,
      onLeave:       rows.filter((r) => r.status === 'ON_LEAVE').length,
      ok:            rows.filter((r) => r.status === 'OK').length,
      underlogged:   rows.filter((r) => r.status === 'UNDERLOGGED').length,
      overlogged:    rows.filter((r) => r.status === 'OVERLOGGED').length,
      contradictions: contradictionsCount,
      totalConflictIssues,
      unmapped:      rows.filter((r) => r.status === 'UNMAPPED').length,
    };

    res.json({ date, totals, employees: rows });
  } catch (err) { next(err); }
});

// GET /api/dashboard/monthly?month=YYYY-MM&onlyProblematic=1
router.get('/monthly', async (req, res, next) => {
  try {
    const now = new Date();
    const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const month  = req.query.month || defaultMonth;
    const filters = {
      onlyProblematic: req.query.onlyProblematic === '1' || req.query.onlyProblematic === 'true',
    };
    const rows = await summaryService.getMonthlySummary(month, filters);
    const totalConflicts = rows.reduce((s, r) => s + (parseInt(r.contradiction_count, 10) || 0), 0);
    res.json({ month, totals: { conflicts: totalConflicts }, employees: rows });
  } catch (err) { next(err); }
});

// GET /api/dashboard/employees/:id?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/employees/:id', async (req, res, next) => {
  try {
    const employeeId = parseInt(req.params.id, 10);
    if (isNaN(employeeId)) return res.status(400).json({ error: 'Invalid employee id' });

    const now = new Date();
    const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const from = toDateString(req.query.from) || req.query.from || defaultFrom;
    const to   = toDateString(req.query.to)   || req.query.to   || toDateString(now);

    const { rows: empRows } = await db.query(
      `SELECT e.*, s.monitoring_mode, s.note AS monitoring_note
       FROM employees e
       LEFT JOIN employee_monitoring_settings s ON s.employee_id = e.id
       WHERE e.id = $1`,
      [employeeId]
    );
    if (empRows.length === 0) return res.status(404).json({ error: 'Employee not found' });

    const employee = empRows[0];

    // Absences in range (fetch early so we can enrich days; include id for contradiction upsert)
    const { rows: absencesRaw } = await db.query(
      `SELECT id, absence_type, date_from, date_to, hours, is_approved
       FROM absences
       WHERE employee_id = $1 AND date_from <= $2 AND date_to >= $3
       ORDER BY date_from ASC`,
      [employeeId, to, from]
    );
    const absences = absencesRaw.map((a) => ({
      ...a,
      date_from: toDateString(a.date_from) || a.date_from,
      date_to:   toDateString(a.date_to)   || a.date_to,
      absence_type_display: getLeaveTypeDisplayLabel(a.absence_type),
    }));

    let days = await summaryService.getEmployeeDetails(employeeId, from, to);

    // Normalize summary_date to YYYY-MM-DD for consistent display
    days = days.map((d) => ({
      ...d,
      summary_date: toDateString(d.summary_date) || d.summary_date,
    }));

    // Enrich days with leave from absences; persist contradictions so they appear on Conflicts page
    const conflictsToUpsert = [];
    days = days.map((d) => {
      const dateStr = d.summary_date;
      const matchingAbsence = absences.find(
        (a) => a.date_from && a.date_to && dateStr >= a.date_from && dateStr <= a.date_to
      );
      if (!matchingAbsence) return d;
      const absenceHours = parseFloat(matchingAbsence.hours) || 8;
      const workHoursPerDay = parseFloat(employee.work_hours_per_day) || 8;
      const isFullDayLeave = absenceHours >= workHoursPerDay;
      const expectedHours = isFullDayLeave ? 0 : Math.max(0, workHoursPerDay - absenceHours);
      const actualHours = parseFloat(d.actual_hours) || 0;
      const deltaHours = actualHours - expectedHours;
      const status = isFullDayLeave
        ? (actualHours > 0 ? 'CONTRADICTION' : 'ON_LEAVE')
        : (Math.abs(deltaHours) <= 0.5 ? 'OK' : deltaHours < -0.5 ? 'UNDERLOGGED' : 'OVERLOGGED');
      const contradictionCount = isFullDayLeave && actualHours > 0 ? 1 : (parseInt(d.contradiction_count, 10) || 0);
      if (isFullDayLeave && actualHours > 0) {
        conflictsToUpsert.push({ dateStr, matchingAbsence, actualHours });
      }
      return {
        ...d,
        leave_type: matchingAbsence.absence_type,
        leave_type_display: getLeaveTypeDisplayLabel(matchingAbsence.absence_type),
        expected_hours: expectedHours,
        delta_hours: deltaHours,
        status,
        contradiction_count: contradictionCount,
      };
    });

    // Persist "logged on leave day" contradictions so the Conflicts page shows them
    for (const { dateStr, matchingAbsence, actualHours } of conflictsToUpsert) {
      try {
        await contradictionService.upsertLoggedOnLeaveContradiction({
          employeeId:   employeeId,
          fullName:     employee.full_name || 'Employee',
          dateStr,
          absenceType:  matchingAbsence.absence_type,
          actualHours,
          absenceId:    matchingAbsence.id || null,
          timeEntryId:  null,
        });
      } catch (err) {
        // Log but don't fail the request
        logger.warn({ err, employeeId, dateStr }, 'Failed to upsert contradiction');
      }
    }

    // Summary totals from enriched days
    const totalExpected = days.reduce((s, r) => s + parseFloat(r.expected_hours), 0);
    const totalActual   = days.reduce((s, r) => s + parseFloat(r.actual_hours), 0);
    const totalContradictions = days.reduce((s, r) => s + parseInt(r.contradiction_count, 10), 0);

    // Recent time entries
    const { rows: entries } = await db.query(
      `SELECT te.entry_date, te.hours, te.project_name, te.issue_id, te.activity_name, te.comments
       FROM time_entries te
       WHERE te.employee_id = $1 AND te.entry_date >= $2 AND te.entry_date <= $3
       ORDER BY te.entry_date DESC LIMIT 100`,
      [employeeId, from, to]
    );

    res.json({
      employee,
      period: { from, to },
      totals: {
        expectedHours:  +totalExpected.toFixed(2),
        actualHours:    +totalActual.toFixed(2),
        deltaHours:     +(totalActual - totalExpected).toFixed(2),
        contradictions: totalContradictions,
      },
      days,
      timeEntries: entries,
      absences,
    });
  } catch (err) { next(err); }
});

module.exports = router;
