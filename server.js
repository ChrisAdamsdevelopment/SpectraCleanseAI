require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs-extra');
const { exiftool } = require('exiftool-vendored');
const { processMediaFile } = require('./server/processor');
const { CLEANSE_POLICY, normalizeExt, isServerSupportedFormat } = require('./server/cleansePolicy');
const cleanup = require('./server/cleanup');
const downloadTokens = require('./server/downloadTokens');
const { createEmailVerificationToken, createPasswordResetToken, hashToken } = require('./server/authTokens');
const { sendEmail, APP_BASE_URL, isEmailDeliveryConfigured } = require('./server/emailService');
const { buildForgotPasswordGenericResponse, buildUnauthResendVerificationGenericResponse } = require('./server/authRecoveryPolicy');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const Database   = require('better-sqlite3');
const Stripe     = require('stripe');
const crypto     = require('crypto');
const rateLimit  = require('express-rate-limit');

// package.json is used for the /api/health version field; require kept inline to avoid
// pulling unrelated fields into module scope.
const pkgVersion = (() => { try { return require('./package.json').version; } catch { return 'unknown'; } })();

// ─────────────────────────────────────────────────────────────────────────────
// Environment validation – strict in production, developer-friendly locally
// ─────────────────────────────────────────────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === 'production';
const FRONTEND_URL = process.env.FRONTEND_URL || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const JWT_SECRET = process.env.JWT_SECRET || (IS_PROD ? '' : 'dev_jwt_secret_change_me');
const ENABLE_MOCK_CHECKOUT =
  process.env.ENABLE_MOCK_CHECKOUT === 'true' || !IS_PROD;

const STRIPE_CONFIGURED = Boolean(
  process.env.STRIPE_SECRET_KEY &&
  process.env.STRIPE_WEBHOOK_SECRET &&
  process.env.STRIPE_CREATOR_PRICE_ID &&
  process.env.STRIPE_STUDIO_PRICE_ID
);

if (!JWT_SECRET) {
  console.error('FATAL: missing required environment variable: JWT_SECRET');
  process.exit(1);
}

if (IS_PROD && !STRIPE_CONFIGURED) {
  console.error('FATAL: Stripe is not fully configured in production.');
  process.exit(1);
}

if (!IS_PROD && !STRIPE_CONFIGURED) {
  console.warn('[Billing] Stripe variables are missing. Mock checkout mode is enabled for local development.');
}

const stripe = STRIPE_CONFIGURED ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

// ─────────────────────────────────────────────────────────────────────────────
// Database – SQLite via better-sqlite3 (WAL mode, FK enforcement)
// ─────────────────────────────────────────────────────────────────────────────
const db = new Database(process.env.DB_PATH || 'spectra.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    email                  TEXT    UNIQUE NOT NULL COLLATE NOCASE,
    password               TEXT    NOT NULL,
    plan                   TEXT    NOT NULL DEFAULT 'free',
    stripe_customer_id     TEXT,
    stripe_subscription_id TEXT,
    created_at             TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename    TEXT    NOT NULL,
    platform    TEXT    NOT NULL DEFAULT 'General',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);
const userColumns = db.prepare(`PRAGMA table_info(users)`).all().map((col) => col.name);
const ensureUserColumn = (name, definition) => {
  if (!userColumns.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
};
ensureUserColumn('email_verified_at', 'TEXT');
ensureUserColumn('email_verification_token_hash', 'TEXT');
ensureUserColumn('email_verification_expires_at', 'TEXT');
ensureUserColumn('email_verification_sent_at', 'TEXT');
ensureUserColumn('password_reset_token_hash', 'TEXT');
ensureUserColumn('password_reset_expires_at', 'TEXT');
ensureUserColumn('password_reset_sent_at', 'TEXT');

const jobColumns = db.prepare(`PRAGMA table_info(jobs)`).all().map((col) => col.name);
const ensureJobColumn = (name, definition) => {
  if (!jobColumns.includes(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`);
};
ensureJobColumn('forensic_status', 'TEXT');
ensureJobColumn('markers_removed', 'INTEGER');

cleanup.init(db);
downloadTokens.init(db);
// ─────────────────────────────────────────────────────────────────────────────
// Usage helpers
// ─────────────────────────────────────────────────────────────────────────────
const FREE_MONTHLY_LIMIT = 3;

function getMonthlyJobCount(userId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM jobs
    WHERE user_id = ?
      AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get(userId);
  return row?.cnt ?? 0;
}

function planFromPriceId(priceId) {
  if (priceId === process.env.STRIPE_STUDIO_PRICE_ID)  return 'studio';
  if (priceId === process.env.STRIPE_CREATOR_PRICE_ID) return 'creator';
  return 'creator'; // safe fallback
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT helpers
// ─────────────────────────────────────────────────────────────────────────────
const JWT_EXPIRES = '7d';

function signToken(userId, email, plan) {
  return jwt.sign({ sub: userId, email, plan }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}
const VERIFICATION_RESEND_MS = 60 * 1000;

async function issueVerificationEmail(user) {
  const nowIso = new Date().toISOString();
  const { token, tokenHash, expiresAt } = createEmailVerificationToken();
  db.prepare(`UPDATE users SET email_verification_token_hash=?, email_verification_expires_at=?, email_verification_sent_at=? WHERE id=?`)
    .run(tokenHash, expiresAt, nowIso, user.id);
  const link = `${APP_BASE_URL.replace(/\/$/, '')}/?verifyToken=${encodeURIComponent(token)}`;
  return sendEmail({
    to: user.email,
    subject: 'Verify your SpectraCleanseAI email',
    text: `Verify your email: ${link}`,
    html: `<p>Verify your email:</p><p><a href="${link}">${link}</a></p>`,
    devLink: link,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth middleware
// ─────────────────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Express setup
// ─────────────────────────────────────────────────────────────────────────────
const app = express();

const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const configuredOrigins = [
  ...ALLOWED_ORIGINS,
  ...(FRONTEND_URL ? [FRONTEND_URL.trim()] : []),
];

const allowedOrigins = new Set(IS_PROD ? configuredOrigins : [...configuredOrigins, ...LOCAL_DEV_ORIGINS]);

if (IS_PROD && allowedOrigins.size === 0) {
  console.error('FATAL: set FRONTEND_URL or ALLOWED_ORIGINS for production CORS configuration.');
  process.exit(1);
}

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: [
    'X-Forensic-Removed', 'X-Forensic-Tags', 'X-Forensic-Status', 'X-Forensic-Report',
    'X-Process-Run-Id', 'X-Output-SHA256', 'X-Download-Name',
    'X-Usage-This-Month', 'X-Usage-Limit',
  ],
}));

// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook – MUST be before express.json() to receive raw body
// ─────────────────────────────────────────────────────────────────────────────
app.post(
  '/api/stripe-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'Stripe webhook unavailable in this environment' });
    }
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body, sig, process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature failed:', err.message);
      return res.status(400).json({ error: `Webhook error: ${err.message}` });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId  = session.metadata?.userId;
      const priceId = session.metadata?.priceId;

      if (!userId) {
        console.error('Webhook: no userId in session metadata');
        return res.json({ received: true });
      }

      const newPlan = planFromPriceId(priceId);
      db.prepare(`
        UPDATE users
        SET plan = ?, stripe_customer_id = ?, stripe_subscription_id = ?
        WHERE id = ?
      `).run(newPlan, session.customer, session.subscription, parseInt(userId, 10));

      console.log(`[Stripe] User ${userId} upgraded to ${newPlan}`);
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      db.prepare(
        `UPDATE users SET plan = 'free', stripe_subscription_id = NULL
         WHERE stripe_subscription_id = ?`
      ).run(sub.id);
      console.log(`[Stripe] Subscription ${sub.id} deleted – user downgraded to free`);
    }

    res.json({ received: true });
  }
);

app.use(express.json({ limit: '10mb' }));

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting
//   Webhook route is registered ABOVE these limiters and is never throttled.
//   Generic 429 JSON keeps frontend handling consistent.
// ─────────────────────────────────────────────────────────────────────────────
const rateLimitMessage = { error: 'Too many requests' };
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
});
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
});

// Auth routes get the tighter limiter mounted first; the global API limiter then
// applies to the rest of /api/*. Health and Stripe webhook are intentionally not gated.
app.use('/api/auth/', authLimiter);
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);
app.use('/api/', (req, res, next) => {
  if (req.path === '/health' || req.path === '/stripe-webhook') return next();
  return apiLimiter(req, res, next);
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth endpoints
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  try {
    const hash   = await bcrypt.hash(password, 12);
    const result = db.prepare(
      'INSERT INTO users (email, password, plan) VALUES (?, ?, ?)'
    ).run(normalizedEmail, hash, 'free');
    const createdUser = { id: result.lastInsertRowid, email: normalizedEmail };
    let verificationNotice = 'Email verification pending.';
    let verificationEmailSent = false;
    try {
      await issueVerificationEmail(createdUser);
      verificationEmailSent = true;
    } catch (emailErr) {
      if (IS_PROD) verificationNotice = 'Account created, but verification email could not be sent. Please contact support.';
      else verificationNotice = 'Account created. Email service unavailable in development fallback.';
    }
    const token = signToken(result.lastInsertRowid, normalizedEmail, 'free');
    return res.status(201).json({
      token,
      user: { id: result.lastInsertRowid, email: normalizedEmail, plan: 'free', emailVerified: false },
      verificationNotice,
      verificationEmailSent,
      emailDeliveryConfigured: isEmailDeliveryConfigured(),
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);

  if (!user) {
    await bcrypt.hash('dummy-constant-time', 12);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken(user.id, user.email, user.plan);
  return res.json({
    token,
    user: { id: user.id, email: user.email, plan: user.plan, emailVerified: Boolean(user.email_verified_at) },
  });
});

// GET /api/me – re-fetch live plan + usage; call after Stripe redirect to pick up upgrade
app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare(
    'SELECT id, email, plan, created_at, email_verified_at FROM users WHERE id = ?'
  ).get(req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const usageThisMonth = getMonthlyJobCount(user.id);
  return res.json({
    user: { ...user, emailVerified: Boolean(user.email_verified_at) },
    usage: {
      thisMonth: usageThisMonth,
      limit: user.plan === 'free' ? FREE_MONTHLY_LIMIT : null,
    },
  });
});

app.post('/api/auth/resend-verification', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  let user = null;
  const isAuthenticatedAttempt = authHeader.startsWith('Bearer ');
  if (isAuthenticatedAttempt) {
    try {
      const parsed = jwt.verify(authHeader.slice(7), JWT_SECRET);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(parsed.sub);
    } catch {}
  } else if (email) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  }
  if (user && !user.email_verified_at) {
    const lastSent = user.email_verification_sent_at ? Date.parse(user.email_verification_sent_at) : 0;
    if (Date.now() - lastSent >= VERIFICATION_RESEND_MS) {
      try {
        await issueVerificationEmail(user);
      } catch (err) {
        if (IS_PROD && err?.code === 'EMAIL_NOT_CONFIGURED') {
          if (isAuthenticatedAttempt) {
            return res.status(503).json({ error: 'Email delivery is not configured on this server.' });
          }
          const generic = buildUnauthResendVerificationGenericResponse(false);
          return res.status(generic.status).json(generic.body);
        }
      }
    }
  }
  if (!isAuthenticatedAttempt) {
    const generic = buildUnauthResendVerificationGenericResponse(isEmailDeliveryConfigured());
    return res.status(generic.status).json(generic.body);
  }
  return res.json({ message: 'If eligible, a verification email has been sent.' });
});

app.get('/api/auth/verify-email', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) return res.status(400).json({ error: 'Missing token' });
  const tokenHash = hashToken(token);
  const user = db.prepare(`SELECT * FROM users WHERE email_verification_token_hash = ?`).get(tokenHash);
  if (!user || !user.email_verification_expires_at || Date.parse(user.email_verification_expires_at) <= Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired verification token.' });
  }
  db.prepare(`UPDATE users SET email_verified_at=?, email_verification_token_hash=NULL, email_verification_expires_at=NULL, email_verification_sent_at=NULL WHERE id=?`)
    .run(new Date().toISOString(), user.id);
  return res.json({ success: true, message: 'Email verified successfully.' });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email) {
    const generic = buildForgotPasswordGenericResponse(isEmailDeliveryConfigured());
    return res.status(generic.status).json(generic.body);
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) {
    if (IS_PROD && !isEmailDeliveryConfigured()) {
      const generic = buildForgotPasswordGenericResponse(false);
      return res.status(generic.status).json(generic.body);
    }
    const { token, tokenHash, expiresAt } = createPasswordResetToken();
    const nowIso = new Date().toISOString();
    const link = `${APP_BASE_URL.replace(/\/$/, '')}/?resetToken=${encodeURIComponent(token)}`;
    try {
      await sendEmail({ to: user.email, subject: 'Reset your SpectraCleanseAI password', text: `Reset password: ${link}`, html: `<a href="${link}">${link}</a>`, devLink: link });
      db.prepare(`UPDATE users SET password_reset_token_hash=?, password_reset_expires_at=?, password_reset_sent_at=? WHERE id=?`)
        .run(tokenHash, expiresAt, nowIso, user.id);
    } catch (err) {
      if (IS_PROD && err?.code === 'EMAIL_NOT_CONFIGURED') {}
    }
  }
  const generic = buildForgotPasswordGenericResponse(isEmailDeliveryConfigured());
  return res.status(generic.status).json(generic.body);
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || typeof token !== 'string' || !newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'Token and a valid new password are required.' });
  }
  const tokenHash = hashToken(token);
  const user = db.prepare('SELECT * FROM users WHERE password_reset_token_hash = ?').get(tokenHash);
  if (!user || !user.password_reset_expires_at || Date.parse(user.password_reset_expires_at) <= Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired reset token.' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  db.prepare(`UPDATE users SET password=?, password_reset_token_hash=NULL, password_reset_expires_at=NULL, password_reset_sent_at=NULL WHERE id=?`)
    .run(passwordHash, user.id);
  return res.json({ success: true, message: 'Password updated successfully.' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stripe Checkout session creation
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/create-checkout-session', requireAuth, async (req, res) => {
  const { plan = 'creator' } = req.body;
  const userId = req.user.sub;
  const dbUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!dbUser) return res.status(404).json({ error: 'User not found' });

  const priceId = plan === 'studio'
    ? process.env.STRIPE_STUDIO_PRICE_ID
    : process.env.STRIPE_CREATOR_PRICE_ID;

  const frontendUrl = FRONTEND_URL;

  if (!stripe || !priceId) {
    if (ENABLE_MOCK_CHECKOUT) {
      const mockUrl = `${frontendUrl}?checkout=success&mockCheckout=1&plan=${encodeURIComponent(plan)}`;
      return res.json({
        url: mockUrl,
        mock: true,
      });
    }
    return res.status(503).json({
      error: 'Stripe checkout is not configured',
      detail: 'Set Stripe env vars or enable mock checkout in local development.',
    });
  }

  try {
    // Re-use existing Stripe customer to preserve billing history
    let customerId = dbUser.stripe_customer_id || undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email:    dbUser.email,
        metadata: { userId: String(userId) },
      });
      customerId = customer.id;
      db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?')
        .run(customerId, userId);
    }

    const session = await stripe.checkout.sessions.create({
      mode:      'subscription',
      customer:  customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${frontendUrl}?checkout=cancelled`,
      metadata: {
        userId:  String(userId),
        priceId: priceId,
      },
      subscription_data: {
        metadata: { userId: String(userId) },
      },
      allow_promotion_codes: true,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Multer
// ─────────────────────────────────────────────────────────────────────────────
// ALLOWED_MIME mirrors CLEANSE_POLICY (quick=mp3, server=mp4/m4a). WAV/FLAC are
// intentionally excluded so Multer rejects them at upload time instead of
// wasting bandwidth on uploads that the processor would 422 anyway.
const ALLOWED_MIME = new Set([
  'audio/mpeg', // .mp3 — passed through so the helpful "use Quick Cleanse" 422 fires
  'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'video/mp4', // .mp4 / .m4a server cleanse
]);
const REJECTED_LEGACY_MIME = new Set([
  'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave',
  'audio/flac', 'audio/x-flac',
]);
const MAX_FILE_SIZE = 500 * 1024 * 1024;

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const ext = (file.originalname || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';
    if (REJECTED_LEGACY_MIME.has(mime) || ext === '.wav' || ext === '.flac') {
      const err = new Error('WAV_FLAC_NOT_SUPPORTED');
      err.code = 'WAV_FLAC_NOT_SUPPORTED';
      return cb(err);
    }
    if (ALLOWED_MIME.has(mime)) return cb(null, true);
    const unsupported = new Error(`Unsupported file type: ${file.mimetype}`);
    unsupported.code = 'UNSUPPORTED_FILE_TYPE';
    return cb(unsupported);
  },
});

fs.ensureDirSync('uploads');

// ─────────────────────────────────────────────────────────────────────────────
// Gemini SEO proxy
// ─────────────────────────────────────────────────────────────────────────────
function asCleanText(v, max = 2000) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

function buildSeoPrompt(payload = {}) {
  const directPrompt = asCleanText(payload.promptText, 4000);
  if (directPrompt) return directPrompt;

  const fields = {
    title: asCleanText(payload.title, 255),
    artist: asCleanText(payload.artist, 255),
    genre: asCleanText(payload.genre, 120),
    platform: asCleanText(payload.platform, 120),
    description: asCleanText(payload.description, 1000),
    tags: asCleanText(payload.tags, 1000),
    lyrics: asCleanText(payload.lyrics, 1200),
    vibe: asCleanText(payload.vibe, 200),
  };

  const hasUsefulStructuredFields = Object.values(fields).some(Boolean);
  if (!hasUsefulStructuredFields) return '';

  return [
    'You are an expert music marketing assistant.',
    'Generate SEO metadata for a song as strict JSON with keys: title, description, tags.',
    `Platform: ${fields.platform || 'General'}`,
    `Current title: ${fields.title || 'Untitled'}`,
    `Artist: ${fields.artist || 'Unknown artist'}`,
    `Genre: ${fields.genre || 'Unknown genre'}`,
    fields.vibe ? `Vibe: ${fields.vibe}` : null,
    fields.description ? `Context description: ${fields.description}` : null,
    fields.tags ? `Existing tags/context: ${fields.tags}` : null,
    fields.lyrics ? `Lyrics excerpt/context: ${fields.lyrics}` : null,
    'Keep title concise, description platform-friendly, and tags comma-separated.',
  ].filter(Boolean).join('\n');
}

app.post('/api/generate-seo', requireAuth, async (req, res) => {
  const promptText = buildSeoPrompt(req.body);
  if (!promptText) {
    return res.status(400).json({ error: 'Invalid prompt payload. Provide promptText or useful SEO fields.' });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                title:       { type: 'STRING' },
                description: { type: 'STRING' },
                tags:        { type: 'STRING' },
              },
              required: ['title', 'description', 'tags'],
            },
          },
        }),
      }
    );
    if (!response.ok) throw new Error(`Gemini error ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return res.status(502).json({ error: 'Malformed JSON returned by Gemini' });
    }

    res.json({
      title: typeof parsed?.title === 'string' ? parsed.title : '',
      description: typeof parsed?.description === 'string' ? parsed.description : '',
      tags: typeof parsed?.tags === 'string' ? parsed.tags : '',
    });
  } catch (err) {
    console.error('Gemini proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Core processing endpoint
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/process', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const userId = req.user.sub;
  const inputPath = req.file.path;
  const originalName = req.file.originalname || '';
  const ext = normalizeExt(originalName);
  const mime = (req.file.mimetype || '').toLowerCase();
  const dbUser = db.prepare('SELECT plan FROM users WHERE id = ?').get(userId);
  const userPlan = dbUser?.plan ?? 'free';
  console.info('[process] request', { fileName: originalName, mime, extension: ext || '(none)', mode: 'server', userPlan });
  if (!isServerSupportedFormat(originalName, mime)) {
    await fs.remove(inputPath).catch(() => {});
    console.info('[process] rejected', { reason: 'unsupported_file_type', extension: ext || '(none)', mime, userPlan });
    return res.status(422).json({
      error: 'Unsupported file type for Full Server Cleanse',
      detail: 'Full Server Cleanse currently supports MP4 and M4A only. Use Quick Cleanse (Browser) for MP3, or convert WAV/FLAC to M4A/MP4.',
      reason: 'unsupported_file_type',
      supportedServerFormats: CLEANSE_POLICY.server.supportedExtensions,
    });
  }
  if (userPlan === 'free') {
    const usedThisMonth = getMonthlyJobCount(userId);
    if (usedThisMonth >= FREE_MONTHLY_LIMIT) {
      await fs.remove(req.file.path).catch(() => {});
      console.info('[process] rejected', { reason: 'usage_limit', userPlan, usedThisMonth, limit: FREE_MONTHLY_LIMIT });
      return res.status(402).json({
        error: 'Monthly limit reached',
        detail: `You've used your ${FREE_MONTHLY_LIMIT} free cleanses this month. Upgrade to Creator for unlimited cleanses and batch processing — starting at $9.99/month.`,
        reason: 'usage_limit',
        usedThisMonth,
        limit: FREE_MONTHLY_LIMIT,
        upgradeRequired: true,
      });
    }
  }
  const { title, description, tags, artist, producer, copyright, genre, lyrics, platform = 'General' } = req.body;
  console.info('[process] metadata received', {
    title,
    artist,
    producer,
    copyright,
    genre,
    hasDescription: Boolean(description),
    hasTags: Boolean(tags),
    hasLyrics: Boolean(lyrics),
    platform,
  });
  const outputPath = path.join('uploads', `out_${Date.now()}${ext}`);
  try { await fs.copy(inputPath, outputPath); } catch { await fs.remove(inputPath).catch(() => {}); return res.status(500).json({ error: 'File copy failed' }); }
  try {
    const { report } = await processMediaFile({ outputPath, originalName: req.file.originalname, platform, metadata: { title, description, tags, artist, producer, copyright, genre, lyrics } });
    try { db.prepare('INSERT INTO jobs (user_id, filename, platform, forensic_status, markers_removed) VALUES (?, ?, ?, ?, ?)').run(userId, req.file.originalname, platform, report.status || null, Number(report.removedCount) || 0); } catch (dbErr) { console.error('Job record failed (non-fatal):', dbErr); }
    const usedNow = getMonthlyJobCount(userId);
    const downloadName = `cleansed_${req.file.originalname}`;
    res.setHeader('X-Forensic-Removed', report.removedCount);
    res.setHeader('X-Forensic-Tags', JSON.stringify(report.removedTags.slice(0, 50)));
    res.setHeader('X-Forensic-Status', report.status || 'Sanitized');
    res.setHeader('X-Forensic-Report', JSON.stringify(report));
    if (report.runId) res.setHeader('X-Process-Run-Id', report.runId);
    if (report.fileHashesByStage?.after_timestamp_write_final) res.setHeader('X-Output-SHA256', report.fileHashesByStage.after_timestamp_write_final);
    res.setHeader('X-Download-Name', downloadName);
    res.setHeader('X-Usage-This-Month', usedNow);
    res.setHeader('X-Usage-Limit', userPlan === 'free' ? FREE_MONTHLY_LIMIT : 'unlimited');
    cleanup.registerForCleanup([outputPath]);
    res.download(outputPath, downloadName, async (err) => { if (err) console.error('Download stream error:', err); await fs.remove(inputPath).catch(() => {}); await cleanup.deleteImmediately(outputPath); });
  } catch (err) {
    console.error('Processing error:', err);
    const status = err.statusCode || 500;
    const reason = err.reason || (status === 422 ? 'unsupported_file_type' : 'server_processing_failure');
    res.status(status).json({ error: status === 422 ? err.message : 'Processing failed', detail: err.publicDetail || err.message, reason });
    await fs.remove(inputPath).catch(() => {});
    await fs.remove(outputPath).catch(() => {});
  }
});

app.post('/api/process-batch', requireAuth, upload.array('files', 20), async (req, res) => {
  const userId = req.user.sub;
  const files = req.files || [];
  const dbUser = db.prepare('SELECT plan FROM users WHERE id = ?').get(userId);
  const userPlan = dbUser?.plan ?? 'free';
  if (userPlan === 'free') { await Promise.all(files.map((f) => fs.remove(f.path).catch(() => {}))); return res.status(403).json({ error: 'Batch processing requires Creator or Studio plan.', reason: 'plan_restriction' }); }
  const totalBytes = files.reduce((n, f) => n + (f.size || 0), 0);
  // 2GB is a post-Multer soft guard; deployment/proxy/body-size limits are still required.
  if (totalBytes > 2 * 1024 * 1024 * 1024) { await Promise.all(files.map((f) => fs.remove(f.path).catch(() => {}))); return res.status(400).json({ error: 'Batch total exceeds 2GB limit.' }); }
  const { title, description, tags, artist, producer, copyright, genre, lyrics, platform = 'General' } = req.body;
  console.info('[process] metadata received', {
    title,
    artist,
    producer,
    copyright,
    genre,
    hasDescription: Boolean(description),
    hasTags: Boolean(tags),
    hasLyrics: Boolean(lyrics),
    platform,
  });
  const results = [];
  for (const file of files) {
    const ext = normalizeExt(file.originalname || '');
    const mime = (file.mimetype || '').toLowerCase();
    if (!isServerSupportedFormat(file.originalname || '', mime)) { await fs.remove(file.path).catch(() => {}); results.push({ originalName: file.originalname, error: 'Full Server Cleanse currently supports MP4 and M4A only. Use Quick Cleanse (Browser) for MP3, or convert WAV/FLAC to M4A/MP4.', reason: 'unsupported_file_type' }); continue; }
    const outputPath = path.join('uploads', `out_batch_${Date.now()}_${crypto.randomUUID()}${ext}`);
    try { await fs.copy(file.path, outputPath); const { report } = await processMediaFile({ outputPath, originalName: file.originalname, platform, metadata: { title, description, tags, artist, producer, copyright, genre, lyrics } }); db.prepare('INSERT INTO jobs (user_id, filename, platform, forensic_status, markers_removed) VALUES (?, ?, ?, ?, ?)').run(userId, file.originalname, platform, report.status || null, Number(report.removedCount) || 0); cleanup.registerForCleanup([outputPath]); const token = downloadTokens.createToken({ userId, filePath: outputPath, downloadName: `cleansed_${file.originalname}` }); results.push({ originalName: file.originalname, report, downloadToken: token }); } catch (err) { await fs.remove(outputPath).catch(() => {}); results.push({ originalName: file.originalname, error: err.publicDetail || err.message }); } finally { await fs.remove(file.path).catch(() => {}); }
  }
  const usedNow = getMonthlyJobCount(userId);
  res.setHeader('X-Usage-This-Month', usedNow);
  res.setHeader('X-Usage-Limit', userPlan === 'free' ? FREE_MONTHLY_LIMIT : 'unlimited');
  return res.json({ results, usage: { thisMonth: usedNow, limit: null } });
});

app.get('/api/jobs', requireAuth, (req, res) => {
  const userId = req.user.sub;
  const rows = db.prepare(
    `SELECT id, filename, platform, forensic_status, markers_removed, created_at
       FROM jobs WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 50`
  ).all(userId);
  return res.json({ jobs: rows });
});

app.get('/api/download/:token', requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const consumed = downloadTokens.consumeToken(req.params.token, userId);
  if (consumed.error) return res.status(consumed.code).json({ error: consumed.error });
  const { filePath, downloadName } = consumed;
  if (!await fs.pathExists(filePath)) return res.status(410).json({ error: 'File is no longer available. It may have already been downloaded or cleaned up.' });
  res.download(filePath, downloadName, async (err) => { if (err) console.error('Download stream error:', err); await cleanup.deleteImmediately(filePath); });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error handlers
// ─────────────────────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: 'File too large (max 500MB)' });
  if (err.code === 'WAV_FLAC_NOT_SUPPORTED')
    return res.status(415).json({
      error: 'WAV and FLAC are not yet supported. Supported formats: MP3, MP4, M4A.',
      code: 'WAV_FLAC_NOT_SUPPORTED',
    });
  if (err.code === 'UNSUPPORTED_FILE_TYPE' || err.message?.startsWith('Unsupported file type'))
    return res.status(415).json({ error: err.message, code: 'UNSUPPORTED_FILE_TYPE' });
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.get('/api/health', (_req, res) =>
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    version: pkgVersion,
    time: new Date().toISOString(),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Public SEO endpoints — served from server so they work in dev and prod
// without depending on Vite's static asset pipeline.
// ─────────────────────────────────────────────────────────────────────────────
const CANONICAL_HOST = 'https://spectracleanse.com';
// ─────────────────────────────────────────────────────────────────────────────
// Admin endpoints (Phase 1 admin health dashboard)
//   Auth: static bearer token via ADMIN_SECRET env. Routes never return user PII.
// ─────────────────────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !process.env.ADMIN_SECRET || token !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

function bytesToMB(n) { return Math.round((n / 1024 / 1024) * 100) / 100; }

function buildAdminHealth() {
  const dbJobCount = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
  const dbUserCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const processedToday = db.prepare(
    `SELECT COUNT(*) AS n FROM jobs WHERE date(created_at) = date('now')`
  ).get().n;
  const errorsToday = db.prepare(
    `SELECT COUNT(*) AS n FROM jobs WHERE date(created_at) = date('now') AND forensic_status = 'review_required'`
  ).get().n;
  const mem = process.memoryUsage();
  return {
    status: 'ok',
    uptime: process.uptime(),
    nodeVersion: process.version,
    dbJobCount,
    dbUserCount,
    processedToday,
    errorRateToday: processedToday > 0 ? Math.round((errorsToday / processedToday) * 10000) / 10000 : 0,
    memoryMB: { rss: bytesToMB(mem.rss), heapUsed: bytesToMB(mem.heapUsed), heapTotal: bytesToMB(mem.heapTotal) },
  };
}

function buildAdminUsageStats() {
  const planRows = db.prepare('SELECT plan, COUNT(*) AS n FROM users GROUP BY plan').all();
  const plans = { free: 0, creator: 0, studio: 0 };
  let totalUsers = 0;
  for (const row of planRows) {
    totalUsers += row.n;
    if (plans[row.plan] !== undefined) plans[row.plan] = row.n;
  }
  const activeThisMonth = db.prepare(
    `SELECT COUNT(DISTINCT user_id) AS n FROM jobs
       WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
  ).get().n;
  return { ...plans, totalUsers, activeThisMonth };
}

app.get('/admin/health', requireAdmin, (_req, res) => res.json(buildAdminHealth()));

app.get('/admin/recent-failures', requireAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const rows = db.prepare(
    `SELECT id, user_id, filename, forensic_status, created_at FROM jobs
       WHERE forensic_status = 'review_required'
       ORDER BY created_at DESC, id DESC LIMIT ?`
  ).all(limit);
  return res.json({
    jobs: rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      filename: row.filename,
      error_message: row.forensic_status,
      created_at: row.created_at,
    })),
  });
});

app.get('/admin/usage-stats', requireAdmin, (_req, res) => res.json(buildAdminUsageStats()));

app.get('/admin', requireAdmin, (_req, res) => {
  const health = buildAdminHealth();
  const usage = buildAdminUsageStats();
  const failures = db.prepare(
    `SELECT id, user_id, filename, forensic_status, created_at FROM jobs
       WHERE forensic_status = 'review_required'
       ORDER BY created_at DESC, id DESC LIMIT 20`
  ).all();
  const escape = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const planBar = (label, count, color) => {
    const pct = usage.totalUsers > 0 ? Math.round((count / usage.totalUsers) * 100) : 0;
    return `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:12px;color:#94a3b8"><span>${escape(label)}</span><span>${count} (${pct}%)</span></div><div style="height:8px;background:#1e293b;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${color}"></div></div></div>`;
  };
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>SpectraCleanse — Admin</title>
<style>
  body { background:#020617; color:#e2e8f0; font-family: system-ui, sans-serif; margin:0; padding:24px; }
  h1 { font-size:18px; margin:0 0 16px; letter-spacing:.5px; text-transform:uppercase; color:#67e8f9; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-bottom:24px; }
  .card { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:14px; }
  .label { font-size:10px; text-transform:uppercase; letter-spacing:.1em; color:#64748b; margin-bottom:4px; }
  .val { font-size:20px; font-family: ui-monospace, monospace; color:#67e8f9; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th, td { padding:6px 10px; border-bottom:1px solid #1e293b; text-align:left; }
  th { color:#64748b; text-transform:uppercase; font-size:10px; }
</style></head>
<body>
  <h1>SpectraCleanse Admin Health</h1>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="val">${escape(health.status)}</div></div>
    <div class="card"><div class="label">Uptime (s)</div><div class="val">${Math.round(health.uptime)}</div></div>
    <div class="card"><div class="label">Node</div><div class="val">${escape(health.nodeVersion)}</div></div>
    <div class="card"><div class="label">Users</div><div class="val">${health.dbUserCount}</div></div>
    <div class="card"><div class="label">Jobs (all-time)</div><div class="val">${health.dbJobCount}</div></div>
    <div class="card"><div class="label">Processed today</div><div class="val">${health.processedToday}</div></div>
    <div class="card"><div class="label">Error rate today</div><div class="val">${(health.errorRateToday * 100).toFixed(2)}%</div></div>
    <div class="card"><div class="label">RSS / Heap MB</div><div class="val">${health.memoryMB.rss} / ${health.memoryMB.heapUsed}</div></div>
  </div>

  <div class="card" style="margin-bottom:24px">
    <div class="label" style="margin-bottom:8px">Plan distribution (active this month: ${usage.activeThisMonth})</div>
    ${planBar('Free', usage.free, '#64748b')}
    ${planBar('Creator', usage.creator, '#06b6d4')}
    ${planBar('Studio', usage.studio, '#8b5cf6')}
  </div>

  <div class="card">
    <div class="label" style="margin-bottom:8px">Recent failures (review_required)</div>
    ${failures.length === 0 ? '<div style="color:#475569;font-size:12px">No recent failures.</div>' : `
    <table>
      <thead><tr><th>ID</th><th>User</th><th>File</th><th>Status</th><th>When</th></tr></thead>
      <tbody>
        ${failures.map((row) => `<tr><td>${row.id}</td><td>${row.user_id}</td><td>${escape(row.filename)}</td><td>${escape(row.forensic_status || '')}</td><td>${escape(row.created_at)}</td></tr>`).join('')}
      </tbody>
    </table>`}
  </div>
</body></html>`;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/sitemap.xml', (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${CANONICAL_HOST}/`, changefreq: 'weekly', priority: '1.0' },
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n')}\n</urlset>\n`;
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.send(body);
});

app.get('/robots.txt', (_req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${CANONICAL_HOST}/sitemap.xml\n`);
});


// Unknown API routes should return JSON (never HTML)
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'API route not found',
    path: req.originalUrl
  });
});

const distPath = path.join(__dirname, 'dist');

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`SpectraCleanse backend on :${PORT}`));

process.on('exit',    () => { exiftool.end(); db.close(); });
process.on('SIGTERM', () => { exiftool.end(); db.close(); process.exit(0); });
