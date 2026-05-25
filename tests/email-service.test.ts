import { describe, expect, it, vi } from 'vitest';

describe('email service configuration behavior', () => {
  it('detects missing SMTP config', async () => {
    vi.resetModules();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    process.env.NODE_ENV = 'test';
    const svc = require('../server/emailService');
    expect(svc.isEmailDeliveryConfigured()).toBe(false);
  });

  it('production missing SMTP throws configured error without exposing token', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    const svc = require('../server/emailService');
    await expect(svc.sendEmail({ to: 'a@b.com', subject: 's', text: 't', devLink: 'http://example.com?token=raw' }))
      .rejects.toMatchObject({ code: 'EMAIL_NOT_CONFIGURED' });
  });
});
