/**
 * Simple HTTP Basic Auth middleware.
 * Credentials are set via ADMIN_USERNAME and ADMIN_PASSWORD env vars.
 *
 * This is suitable for an internal tool behind a reverse proxy.
 * For public-facing deployments, replace with proper OAuth/JWT.
 */
const config = require('../config');

function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Basic ')) {
    return challenge(res);
  }
  const base64 = authHeader.slice('Basic '.length);
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  const [user, ...rest] = decoded.split(':');
  const pass = rest.join(':');

  if (
    timingSafeEqual(user, config.ADMIN_USERNAME) &&
    timingSafeEqual(pass, config.ADMIN_PASSWORD)
  ) {
    return next();
  }
  return challenge(res);
}

function challenge(res) {
  res.set('WWW-Authenticate', 'Basic realm="Worklog Dashboard"');
  res.status(401).json({ error: 'Authentication required' });
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

module.exports = basicAuth;
