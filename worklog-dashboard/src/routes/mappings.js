const express = require('express');
const { z }   = require('zod');
const db      = require('../db');

const router = express.Router();

// GET /api/mappings/unresolved
router.get('/unresolved', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM employee_mapping_queue WHERE status = 'pending' ORDER BY created_at DESC`
    );
    res.json({ total: rows.length, queue: rows });
  } catch (err) { next(err); }
});

// PATCH /api/mappings/:id  — confirm or reject a mapping proposal
const patchSchema = z.object({
  status:         z.enum(['confirmed', 'rejected']),
  redmine_user_id: z.number().int().positive().optional(),
});

router.patch('/:id', async (req, res, next) => {
  try {
    const queueId = parseInt(req.params.id, 10);
    const parsed  = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

    const { status, redmine_user_id } = parsed.data;

    const { rows: qRows } = await db.query(
      'SELECT * FROM employee_mapping_queue WHERE id = $1',
      [queueId]
    );
    if (qRows.length === 0) return res.status(404).json({ error: 'Not found' });
    const qRow = qRows[0];

    if (status === 'confirmed' && redmine_user_id) {
      // Save mapping to employees table
      await db.query(
        `UPDATE employees SET redmine_user_id = $1, updated_at = NOW()
         WHERE hurma_employee_id = $2`,
        [redmine_user_id, qRow.hurma_employee_id]
      );
    }

    await db.query(
      `UPDATE employee_mapping_queue SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, queueId]
    );

    res.json({ ok: true, status });
  } catch (err) { next(err); }
});

// GET /api/mappings/employees — combined view of all employees with mapping status
router.get('/employees', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT
         e.id, e.hurma_employee_id, e.redmine_user_id, e.full_name, e.email,
         e.is_active, s.monitoring_mode,
         q.id AS queue_id, q.status AS queue_status,
         q.redmine_username, q.redmine_email
       FROM employees e
       LEFT JOIN employee_monitoring_settings s ON s.employee_id = e.id
       LEFT JOIN employee_mapping_queue q ON q.hurma_employee_id = e.hurma_employee_id
         AND q.status = 'pending'
       ORDER BY e.full_name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
