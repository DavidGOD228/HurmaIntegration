'use strict';

/**
 * Raw body capture middleware.
 *
 * HMAC signature verification requires the exact raw request bytes.
 * Express's built-in json() parser discards the raw body, so we capture
 * it before parsing and attach it to req.rawBody.
 *
 * Must be applied BEFORE express.json() on the webhook route.
 */
const express = require('express');

function rawBodyMiddleware(req, res, next) {
  express.raw({ type: '*/*', limit: '1mb' })(req, res, (err) => {
    if (err) return next(err);
    // At this point req.body is a Buffer (raw bytes)
    req.rawBody = req.body;
    // Parse JSON manually so downstream code gets a plain object
    try {
      req.body = req.rawBody.length > 0 ? JSON.parse(req.rawBody.toString('utf8')) : {};
    } catch {
      // Leave body as-is if not valid JSON; signature check will still use rawBody
      req.body = {};
    }
    next();
  });
}

module.exports = rawBodyMiddleware;
