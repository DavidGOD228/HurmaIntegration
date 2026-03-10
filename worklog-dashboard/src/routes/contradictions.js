const express = require('express');
const contradictionService = require('../services/contradiction.service');
const db = require('../db');

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
    res.json({ total: rows.length, contradictions: rows });
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
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
