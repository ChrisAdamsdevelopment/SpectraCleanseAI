import { describe, expect, it } from 'vitest';
const { createEmailVerificationToken, createPasswordResetToken, hashToken, isTokenExpired } = require('../server/authTokens');

describe('auth token helpers', () => {
  it('creates raw token + hash and hash lookup matches', () => {
    const pair = createEmailVerificationToken();
    expect(pair.token).toBeTypeOf('string');
    expect(pair.tokenHash).toBe(hashToken(pair.token));
  });

  it('sets password reset expiry and rejects expired token', () => {
    const pair = createPasswordResetToken(0);
    expect(isTokenExpired(pair.expiresAt, 59 * 60 * 1000)).toBe(false);
    expect(isTokenExpired(pair.expiresAt, 61 * 60 * 1000)).toBe(true);
  });
});
