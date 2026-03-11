const express = require('express');
const contradictionService = require('../services/contradiction.service');
const summaryService = require('../services/summary.service');
const db = require('../db');
const { toDateString } = require('../utils/workdays');

const router = express.Router();

// GET /api/contradictions?from=&to=&employeeId=&type=&severity=&resolved=
router.get('/', async (req, res, next) => {
  try {
    const {
      from, to, employeeId, type, severity,
      resolved = 'false',
    } = req.query;

    const rows = await contradictionService.getContradictions({
      from:       from || null,
      to:         to   || null,
      employeeId: employeeId ? parseInt(employeeId, 10) : undefined,
      type:       type       || undefined,
      severity:   severity   || undefined,
      resolved:   resolved === 'true',
    });
    const contradictions = rows.map((c) => ({
      ...c,
      contradiction_date: toDateString(c.contradiction_date) || c.contradiction_date,
    }));
    res.json({ total: contradictions.length, contradictions });
  } catch (err) { next(err); }
});

// PATCH /api/contradictions/:id/resolve
router.patch('/:id/resolve', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await db.query(
      `UPDATE contradictions SET is_resolved = true WHERE id = $1 RETURNING *`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const c = rows[0];
    const dateStr = toDateString(c.contradiction_date);
    // Recompute that day's summary so contradiction_count and status are correct
    const { rows: empRows } = await db.query(
      `SELECT e.id, e.full_name, e.redmine_user_id, e.work_hours_per_day, s.monitoring_mode
       FROM employees e
       LEFT JOIN employee_monitoring_settings s ON s.employee_id = e.id
       WHERE e.id = $1`,
      [c.employee_id]
    );
    if (empRows.length > 0) {
      const { rows: absences } = await db.query(
        `SELECT * FROM absences WHERE employee_id = $1 AND date_from <= $2 AND date_to >= $3`,
        [c.employee_id, dateStr, dateStr]
      );
      const { rows: hRows } = await db.query('SELECT holiday_date FROM public_holidays');
      const holidaySet = new Set(hRows.map((r) => toDateString(r.holiday_date)));
      await summaryService.computeDaySummary(empRows[0], dateStr, absences, holidaySet);
    }
    res.json(c);
  } catch (err) { next(err); }
});

module.exports = router;
