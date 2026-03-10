import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// ── Dashboard ──────────────────────────────────────────────────────────────
export const getDaily = (params) =>
  api.get('/dashboard/daily', { params }).then((r) => r.data);

export const getMonthly = (params) =>
  api.get('/dashboard/monthly', { params }).then((r) => r.data);

export const getEmployeeDetails = (id, params) =>
  api.get(`/dashboard/employees/${id}`, { params }).then((r) => r.data);

// ── Settings ───────────────────────────────────────────────────────────────
export const getSettingsEmployees = (params) =>
  api.get('/settings/employees', { params }).then((r) => r.data);

export const patchEmployee = (id, data) =>
  api.patch(`/settings/employees/${id}`, data).then((r) => r.data);

// ── Sync ───────────────────────────────────────────────────────────────────
export const triggerSync = (data) =>
  api.post('/sync/run', data).then((r) => r.data);

export const getSyncRuns = (params) =>
  api.get('/sync/runs', { params }).then((r) => r.data);

// ── Contradictions ─────────────────────────────────────────────────────────
export const getContradictions = (params) =>
  api.get('/contradictions', { params }).then((r) => r.data);

export const resolveContradiction = (id) =>
  api.patch(`/contradictions/${id}/resolve`).then((r) => r.data);

// ── Mappings ───────────────────────────────────────────────────────────────
export const getUnresolvedMappings = () =>
  api.get('/mappings/unresolved').then((r) => r.data);

export const patchMapping = (id, data) =>
  api.patch(`/mappings/${id}`, data).then((r) => r.data);
