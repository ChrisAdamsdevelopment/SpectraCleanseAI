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
const crypto = require('crypto');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const Database   = require('better-sqlite3');
const Stripe     = require('stripe');

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

    const token = signToken(result.lastInsertRowid, normalizedEmail, 'free');
    return res.status(201).json({
      token,
      user: { id: result.lastInsertRowid, email: normalizedEmail, plan: 'free' },
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
    user: { id: user.id, email: user.email, plan: user.plan },
  });
});

// GET /api/me – re-fetch live plan + usage; call after Stripe redirect to pick up upgrade
app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare(
    'SELECT id, email, plan, created_at FROM users WHERE id = ?'
  ).get(req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const usageThisMonth = getMonthlyJobCount(user.id);
  return res.json({
    user,
    usage: {
      thisMonth: usageThisMonth,
      limit: user.plan === 'free' ? FREE_MONTHLY_LIMIT : null,
    },
  });
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
const ALLOWED_MIME = new Set([
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/x-flac',
  'audio/mp4', 'audio/m4a', 'video/mp4',
]);
const MAX_FILE_SIZE = 500 * 1024 * 1024;

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    ALLOWED_MIME.has(file.mimetype)
      ? cb(null, true)
      : cb(new Error(`Unsupported file type: ${file.mimetype}`));
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
      return res.status(402).json({ error: 'Monthly limit reached', detail: `Free accounts are limited to ${FREE_MONTHLY_LIMIT} files per month. Upgrade to continue processing.`, reason: 'usage_limit', usedThisMonth, limit: FREE_MONTHLY_LIMIT, upgradeRequired: true });
    }
  }
  const { title, description, tags, artist, producer, copyright, genre, lyrics, platform = 'General' } = req.body;
  const outputPath = path.join('uploads', `out_${Date.now()}${ext}`);
  try { await fs.copy(inputPath, outputPath); } catch { await fs.remove(inputPath).catch(() => {}); return res.status(500).json({ error: 'File copy failed' }); }
  try {
    const { report } = await processMediaFile({ outputPath, originalName: req.file.originalname, platform, metadata: { title, description, tags, artist, producer, copyright, genre, lyrics } });
    try { db.prepare('INSERT INTO jobs (user_id, filename, platform) VALUES (?, ?, ?)').run(userId, req.file.originalname, platform); } catch (dbErr) { console.error('Job record failed (non-fatal):', dbErr); }
    const usedNow = getMonthlyJobCount(userId);
    res.setHeader('X-Forensic-Removed', report.removedCount);
    res.setHeader('X-Forensic-Tags', JSON.stringify(report.removedTags.slice(0, 50)));
    res.setHeader('X-Forensic-Status', report.status || 'Sanitized');
    res.setHeader('X-Forensic-Report', JSON.stringify(report));
    res.setHeader('X-Usage-This-Month', usedNow);
    res.setHeader('X-Usage-Limit', userPlan === 'free' ? FREE_MONTHLY_LIMIT : 'unlimited');
    cleanup.registerForCleanup([outputPath]);
    res.download(outputPath, `cleansed_${req.file.originalname}`, async (err) => { if (err) console.error('Download stream error:', err); await fs.remove(inputPath).catch(() => {}); await cleanup.deleteImmediately(outputPath); });
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
  const results = [];
  for (const file of files) {
    const ext = normalizeExt(file.originalname || '');
    const mime = (file.mimetype || '').toLowerCase();
    if (!isServerSupportedFormat(file.originalname || '', mime)) { await fs.remove(file.path).catch(() => {}); results.push({ originalName: file.originalname, error: 'Full Server Cleanse currently supports MP4 and M4A only. Use Quick Cleanse (Browser) for MP3, or convert WAV/FLAC to M4A/MP4.', reason: 'unsupported_file_type' }); continue; }
    const outputPath = path.join('uploads', `out_batch_${Date.now()}_${crypto.randomUUID()}${ext}`);
    try { await fs.copy(file.path, outputPath); const { report } = await processMediaFile({ outputPath, originalName: file.originalname, platform, metadata: { title, description, tags, artist, producer, copyright, genre, lyrics } }); db.prepare('INSERT INTO jobs (user_id, filename, platform) VALUES (?, ?, ?)').run(userId, file.originalname, platform); cleanup.registerForCleanup([outputPath]); const token = downloadTokens.createToken({ userId, filePath: outputPath, downloadName: `cleansed_${file.originalname}` }); results.push({ originalName: file.originalname, report, downloadToken: token }); } catch (err) { await fs.remove(outputPath).catch(() => {}); results.push({ originalName: file.originalname, error: err.publicDetail || err.message }); } finally { await fs.remove(file.path).catch(() => {}); }
  }
  const usedNow = getMonthlyJobCount(userId);
  res.setHeader('X-Usage-This-Month', usedNow);
  res.setHeader('X-Usage-Limit', userPlan === 'free' ? FREE_MONTHLY_LIMIT : 'unlimited');
  return res.json({ results, usage: { thisMonth: usedNow, limit: null } });
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
  if (err.message?.startsWith('Unsupported file type'))
    return res.status(415).json({ error: err.message });
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString() })
);


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
