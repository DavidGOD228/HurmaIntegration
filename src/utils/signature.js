'use strict';

const crypto = require('crypto');

/**
 * Verifies a Fireflies HMAC-SHA256 webhook signature.
 *
 * Fireflies signs the raw request body with the webhook secret and sends
 * the hex digest in the `x-hub-signature` header.
 *
 * @param {Buffer} rawBody  - Raw request body buffer (must be raw, not parsed)
 * @param {string} signature - Value of `x-hub-signature` header
 * @param {string} secret   - FIREFLIES_WEBHOOK_SECRET from environment
 * @returns {boolean}
 */
function verifyFirefliesSignature(rawBody, signature, secret) {
  if (!signature || !rawBody || !secret) return false;

  // Fireflies sends the signature as a plain hex string (no "sha256=" prefix in some versions).
  // We support both formats.
  const sigHex = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // timingSafeEqual requires equal-length buffers.
  // If the provided signature is malformed/wrong length it is simply invalid.
  const sigBuf = Buffer.from(sigHex, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  if (sigBuf.length !== expectedBuf.length) return false;

  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

module.exports = { verifyFirefliesSignature };
