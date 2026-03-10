const express = require('express');
const { z }   = require('zod');
const db      = require('../db');

const router = express.Router();

const MONITORING_MODES = ['included', 'excluded', 'ignored_fulltime_external_project'];

// GET /api/settings/employees?search=&mode=&page=&limit=
router.get('/employees', async (req, res, next) => {
  try {
    const search = req.query.search || '';
    const mode   = req.query.mode   || '';
    const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit  = Math.min(200, parseInt(req.query.limit, 10) || 50);
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;

    if (search) {
      where += ` AND (e.full_name ILIKE $${idx} OR e.email ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    if (mode && MONITORING_MODES.includes(mode)) {
      where += ` AND s.monitoring_mode = $${idx++}`;
      params.push(mode);
    }

    const countSql = `
      SELECT COUNT(*) AS total
      FROM employees e
      LEFT JOIN employee_monitoring_settings s ON s.employee_id = e.id
      ${where}
    `;
    const rowsSql = `
      SELECT
        e.id, e.hurma_employee_id, e.redmine_user_id,
        e.full_name, e.email, e.department, e.position,
        e.is_active, e.work_hours_per_day,
        COALESCE(s.monitoring_mode, 'excluded') AS monitoring_mode,
        s.note,
        CASE WHEN e.redmine_user_id IS NOT NULL THEN 'mapped' ELSE 'unmapped' END AS redmine_status
      FROM employees e
      LEFT JOIN employee_monitoring_settings s ON s.employee_id = e.id
      ${where}
      ORDER BY e.full_name
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    const [countResult, rowsResult] = await Promise.all([
      db.query(countSql, params),
      db.query(rowsSql, [...params, limit, offset]),
    ]);

    res.json({
      total:     parseInt(countResult.rows[0].total, 10),
      page,
      limit,
      employees: rowsResult.rows,
    });
  } catch (err) { next(err); }
});

// PATCH /api/settings/employees/:id
const patchSchema = z.object({
  monitoring_mode: z.enum(MONITORING_MODES).optional(),
  note:            z.string().max(500).optional().nullable(),
  redmine_user_id: z.number().int().positive().optional().nullable(),
  work_hours_per_day: z.number().min(1).max(24).optional(),
});

router.patch('/employees/:id', async (req, res, next) => {
  try {
    const employeeId = parseInt(req.params.id, 10);
    if (isNaN(employeeId)) return res.status(400).json({ error: 'Invalid id' });

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

    const { monitoring_mode, note, redmine_user_id, work_hours_per_day } = parsed.data;

    const { rows: emp } = await db.query('SELECT id FROM employees WHERE id = $1', [employeeId]);
    if (emp.length === 0) return res.status(404).json({ error: 'Employee not found' });

    if (monitoring_mode !== undefined || note !== undefined) {
      await db.query(
        `INSERT INTO employee_monitoring_settings (employee_id, monitoring_mode, note, updated_at)
         VALUES ($1, COALESCE($2,'excluded'), $3, NOW())
         ON CONFLICT (employee_id) DO UPDATE SET
           monitoring_mode = COALESCE($2, employee_monitoring_settings.monitoring_mode),
           note            = COALESCE($3, employee_monitoring_settings.note),
           updated_at      = NOW()`,
        [employeeId, monitoring_mode || null, note !== undefined ? note : null]
      );
    }

    if (redmine_user_id !== undefined || work_hours_per_day !== undefined) {
      const updates = [];
      const vals    = [];
      let i = 1;
      if (redmine_user_id !== undefined)   { updates.push(`redmine_user_id = $${i++}`);   vals.push(redmine_user_id); }
      if (work_hours_per_day !== undefined) { updates.push(`work_hours_per_day = $${i++}`); vals.push(work_hours_per_day); }
      if (updates.length) {
        updates.push(`updated_at = NOW()`);
        vals.push(employeeId);
        await db.query(`UPDATE employees SET ${updates.join(', ')} WHERE id = $${i}`, vals);
      }
    }

    const { rows } = await db.query(
      `SELECT e.*, COALESCE(s.monitoring_mode,'excluded') AS monitoring_mode, s.note
       FROM employees e
       LEFT JOIN employee_monitoring_settings s ON s.employee_id = e.id
       WHERE e.id = $1`,
      [employeeId]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/settings/employees/:id  — single employee settings
router.get('/employees/:id', async (req, res, next) => {
  try {
    const employeeId = parseInt(req.params.id, 10);
    const { rows } = await db.query(
      `SELECT e.*, COALESCE(s.monitoring_mode,'excluded') AS monitoring_mode, s.note
       FROM employees e
       LEFT JOIN employee_monitoring_settings s ON s.employee_id = e.id
       WHERE e.id = $1`,
      [employeeId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
