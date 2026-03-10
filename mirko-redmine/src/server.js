require('dotenv').config();
const express = require('express');
const redmine = require('./redmine');

const app = express();
const PORT = process.env.PORT || 3100;

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'mirko-redmine-app' });
});

// Validate Redmine connection and API key
app.get('/api/redmine/me', async (req, res) => {
  try {
    const user = await redmine.getCurrentUser();
    res.json({ ok: true, user });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      ok: false,
      error: err.message,
      detail: err.response?.data,
    });
  }
});

// List projects
app.get('/api/redmine/projects', async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const data = await redmine.getProjects({
      limit: limit ? parseInt(limit, 10) : 25,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      ok: false,
      error: err.message,
      detail: err.response?.data,
    });
  }
});

// List issues
app.get('/api/redmine/issues', async (req, res) => {
  try {
    const { project_id, limit, offset, status_id, tracker_id } = req.query;
    const data = await redmine.getIssues({
      projectId: project_id,
      limit: limit ? parseInt(limit, 10) : 25,
      offset: offset ? parseInt(offset, 10) : 0,
      statusId: status_id,
      trackerId: tracker_id,
    });
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      ok: false,
      error: err.message,
      detail: err.response?.data,
    });
  }
});

// Get one issue
app.get('/api/redmine/issues/:id', async (req, res) => {
  try {
    const include = (req.query.include || '').split(',').filter(Boolean);
    const issue = await redmine.getIssue(req.params.id, include);
    res.json({ issue });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      ok: false,
      error: err.message,
      detail: err.response?.data,
    });
  }
});

// Create issue (proxy to Redmine)
app.post('/api/redmine/issues', async (req, res) => {
  try {
    const issue = await redmine.createIssue(req.body);
    res.status(201).json({ issue });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      ok: false,
      error: err.message,
      detail: err.response?.data,
    });
  }
});

// Update issue (proxy to Redmine)
app.patch('/api/redmine/issues/:id', async (req, res) => {
  try {
    const issue = await redmine.updateIssue(req.params.id, req.body);
    res.json({ issue });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      ok: false,
      error: err.message,
      detail: err.response?.data,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Mirko Redmine app listening on port ${PORT}`);
  if (!process.env.REDMINE_API_KEY) {
    console.warn('REDMINE_API_KEY is not set — API routes will fail');
  }
});
