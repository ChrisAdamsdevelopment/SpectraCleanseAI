import { describe, expect, it } from 'vitest';
const { buildForgotPasswordGenericResponse, buildUnauthResendVerificationGenericResponse } = require('../server/authRecoveryPolicy');

describe('auth recovery enumeration-safe response policy', () => {
  it('forgot-password generic response is stable regardless of email existence context', () => {
    const a = buildForgotPasswordGenericResponse(false);
    const b = buildForgotPasswordGenericResponse(false);
    expect(a.status).toBe(200);
    expect(a.body.message).toBe('If an account exists, a reset link was sent.');
    expect(a).toEqual(b);
  });

  it('unauth resend-verification generic response is stable', () => {
    const a = buildUnauthResendVerificationGenericResponse(false);
    const b = buildUnauthResendVerificationGenericResponse(false);
    expect(a.status).toBe(200);
    expect(a.body.message).toBe('If eligible, a verification email has been sent.');
    expect(a).toEqual(b);
  });
});
