const express = require('express');
const { z }   = require('zod');
const summaryService = require('../services/summary.service');
const db = require('../db');
const { toDateString } = require('../utils/workdays');

const router = express.Router();

// GET /api/dashboard/daily?date=YYYY-MM-DD&onlyProblematic=1&onlyContradictions=1
router.get('/daily', async (req, res, next) => {
  try {
    const date = req.query.date || toDateString(new Date());
    const filters = {
      onlyProblematic:    req.query.onlyProblematic === '1' || req.query.onlyProblematic === 'true',
      onlyContradictions: req.query.onlyContradictions === '1' || req.query.onlyContradictions === 'true',
    };
    const rows = await summaryService.getDailySummary(date, filters);

    // Totals
    const totals = {
      monitored:     rows.length,
      onLeave:       rows.filter((r) => r.status === 'ON_LEAVE').length,
      ok:            rows.filter((r) => r.status === 'OK').length,
      underlogged:   rows.filter((r) => r.status === 'UNDERLOGGED').length,
      overlogged:    rows.filter((r) => r.status === 'OVERLOGGED').length,
      contradictions:rows.filter((r) => r.status === 'CONTRADICTION').length,
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
    res.json({ month, employees: rows });
  } catch (err) { next(err); }
});

// GET /api/dashboard/employees/:id?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/employees/:id', async (req, res, next) => {
  try {
    const employeeId = parseInt(req.params.id, 10);
    if (isNaN(employeeId)) return res.status(400).json({ error: 'Invalid employee id' });

    const now = new Date();
    const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const from = req.query.from || defaultFrom;
    const to   = req.query.to   || toDateString(now);

    const { rows: empRows } = await db.query(
      `SELECT e.*, s.monitoring_mode, s.note AS monitoring_note
       FROM employees e
       LEFT JOIN employee_monitoring_settings s ON s.employee_id = e.id
       WHERE e.id = $1`,
      [employeeId]
    );
    if (empRows.length === 0) return res.status(404).json({ error: 'Employee not found' });

    const employee = empRows[0];
    const days     = await summaryService.getEmployeeDetails(employeeId, from, to);

    // Summary totals for period
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

    // Absences in range
    const { rows: absences } = await db.query(
      `SELECT absence_type, date_from, date_to, hours, is_approved
       FROM absences
       WHERE employee_id = $1 AND date_from <= $2 AND date_to >= $3
       ORDER BY date_from ASC`,
      [employeeId, to, from]
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
