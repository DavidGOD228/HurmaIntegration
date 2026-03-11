const express = require('express');
const { z }   = require('zod');
const syncService = require('../services/sync.service');
const hurma       = require('../clients/hurma');
const db          = require('../db');
const { toDateString } = require('../utils/workdays');

const router = express.Router();

const runSchema = z.object({
  type: z.enum(['employees', 'absences', 'time_entries', 'summaries', 'all']).default('all'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  wait:  z.boolean().optional(),
});

// POST /api/sync/run  — trigger a manual sync. If wait=true, runs synchronously and returns when done.
router.post('/run', async (req, res, next) => {
  try {
    const parsed = runSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

    const now  = new Date();
    const type = parsed.data.type;
    const to   = parsed.data.to   || toDateString(now);
    const fromDefault = new Date(now);
    fromDefault.setDate(fromDefault.getDate() - 90);
    const from = parsed.data.from || toDateString(fromDefault);
    const wait = parsed.data.wait === true;

    const runSync = async () => {
      switch (type) {
        case 'employees':    await syncService.syncEmployees(); break;
        case 'absences':     await syncService.syncAbsences(from, to); break;
        case 'time_entries': await syncService.syncTimeEntries(from, to); break;
        case 'summaries':    await syncService.recomputeSummaries(from, to); break;
        default:             await syncService.runFullSync(from, to); break;
      }
    };

    if (wait) {
      req.setTimeout(300000);
      const start = Date.now();
      try {
        await runSync();
        res.json({ status: 'success', type, from, to, durationMs: Date.now() - start });
      } catch (err) {
        require('../utils/logger').error({ err }, 'Manual sync failed');
        res.status(500).json({ status: 'failed', error: err.message, durationMs: Date.now() - start });
      }
    } else {
      res.json({ status: 'started', type, from, to });
      setImmediate(async () => {
        try {
          await runSync();
        } catch (err) {
          require('../utils/logger').error({ err }, 'Manual sync failed');
        }
      });
    }
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

// GET /api/sync/absences-debug?from=YYYY-MM-DD&to=YYYY-MM-DD — verify absences in DB
router.get('/absences-debug', async (req, res, next) => {
  try {
    const from = req.query.from || toDateString(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
    const to   = req.query.to   || toDateString(new Date());
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS cnt FROM absences WHERE date_from <= $1 AND date_to >= $2`,
      [to, from]
    );
    const { rows: sample } = await db.query(
      `SELECT a.id, a.employee_id, e.full_name, a.absence_type, a.date_from, a.date_to
       FROM absences a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.date_from <= $1 AND a.date_to >= $2
       ORDER BY a.date_from DESC LIMIT 10`,
      [to, from]
    );
    res.json({ from, to, count: parseInt(countRows[0].cnt, 10), sample });
  } catch (err) { next(err); }
});

// GET /api/sync/hurma-absences-debug — fetch raw from Hurma API to see response structure
router.get('/hurma-absences-debug', async (req, res, next) => {
  try {
    const from = req.query.from || toDateString(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const to   = req.query.to   || toDateString(new Date());
    const raw  = await hurma.debugAbsencesFetch(from, to);
    res.json(raw);
  } catch (err) { next(err); }
});

module.exports = router;
