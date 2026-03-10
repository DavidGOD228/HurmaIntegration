const express = require('express');
const { z }   = require('zod');
const syncService = require('../services/sync.service');
const db          = require('../db');
const { toDateString } = require('../utils/workdays');

const router = express.Router();

const runSchema = z.object({
  type: z.enum(['employees', 'absences', 'time_entries', 'summaries', 'all']).default('all'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// POST /api/sync/run  — trigger a manual sync
router.post('/run', async (req, res, next) => {
  try {
    const parsed = runSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

    const now  = new Date();
    const type = parsed.data.type;
    const from = parsed.data.from || toDateString(new Date(now.getFullYear(), now.getMonth(), 1));
    const to   = parsed.data.to   || toDateString(now);

    // Fire-and-forget; respond immediately
    res.json({ status: 'started', type, from, to });

    setImmediate(async () => {
      try {
        switch (type) {
          case 'employees':    await syncService.syncEmployees(); break;
          case 'absences':     await syncService.syncAbsences(from, to); break;
          case 'time_entries': await syncService.syncTimeEntries(from, to); break;
          case 'summaries':    await syncService.recomputeSummaries(from, to); break;
          default:             await syncService.runFullSync(from, to); break;
        }
      } catch (err) {
        require('../utils/logger').error({ err }, 'Manual sync failed');
      }
    });
  } catch (err) { next(err); }
});

// GET /api/sync/runs?limit=20  — recent sync history
router.get('/runs', async (req, res, next) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
    const { rows } = await db.query(
      `SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/sync/status — current running syncs
router.get('/status', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM sync_runs WHERE status = 'running' ORDER BY started_at DESC`
    );
    res.json({ running: rows });
  } catch (err) { next(err); }
});

module.exports = router;
