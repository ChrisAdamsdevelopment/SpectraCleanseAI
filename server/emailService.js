const APP_BASE_URL = process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
const isProd = () => process.env.NODE_ENV === 'production';

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );
}

async function sendEmail({ to, subject, text, html, devLink }) {
  if (!smtpConfigured()) {
    if (isProd()) {
      const err = new Error('Email delivery is not configured on this server.');
      err.code = 'EMAIL_NOT_CONFIGURED';
      throw err;
    }
    console.warn(`[Email:dev-fallback] would send "${subject}" to ${to}`);
    if (devLink) console.warn(`[Email:dev-fallback] link: ${devLink}`);
    return { delivered: false, mode: 'dev-fallback' };
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    throw new Error('Email provider dependency is missing (nodemailer).');
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, text, html });
  return { delivered: true, mode: 'smtp' };
}

module.exports = { sendEmail, APP_BASE_URL, isEmailDeliveryConfigured: smtpConfigured };
