const crypto = require('crypto');

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function createTokenPair(bytes = 32) {
  const token = crypto.randomBytes(bytes).toString('hex');
  return { token, tokenHash: hashToken(token) };
}

function createEmailVerificationToken(now = Date.now()) {
  const { token, tokenHash } = createTokenPair();
  return { token, tokenHash, expiresAt: new Date(now + VERIFICATION_TTL_MS).toISOString() };
}

function createPasswordResetToken(now = Date.now()) {
  const { token, tokenHash } = createTokenPair();
  return { token, tokenHash, expiresAt: new Date(now + RESET_TTL_MS).toISOString() };
}

function isTokenExpired(expiresAt, now = Date.now()) {
  if (!expiresAt) return true;
  return Date.parse(expiresAt) <= now;
}

module.exports = {
  VERIFICATION_TTL_MS,
  RESET_TTL_MS,
  hashToken,
  createEmailVerificationToken,
  createPasswordResetToken,
  isTokenExpired,
};
