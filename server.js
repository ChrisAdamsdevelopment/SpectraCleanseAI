require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs-extra');
const { exiftool } = require('exiftool-vendored');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const Database   = require('better-sqlite3');
const Stripe     = require('stripe');

// ─────────────────────────────────────────────────────────────────────────────
// Environment validation – strict in production, developer-friendly locally
// ─────────────────────────────────────────────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === 'production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
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

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || FRONTEND_URL;
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: [
    'X-Forensic-Removed', 'X-Forensic-Tags', 'X-Forensic-Status',
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
app.post('/api/generate-seo', requireAuth, async (req, res) => {
  const { promptText } = req.body;
  if (!promptText || typeof promptText !== 'string' || promptText.length > 4000) {
    return res.status(400).json({ error: 'Invalid prompt' });
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
    res.json(JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'));
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

  // ── Tier-based usage enforcement ─────────────────────────────────────────
  // Always re-read plan from DB so upgrades (via webhook) take effect
  // immediately without forcing a re-login.
  const dbUser   = db.prepare('SELECT plan FROM users WHERE id = ?').get(userId);
  const userPlan = dbUser?.plan ?? 'free';

  if (userPlan === 'free') {
    const usedThisMonth = getMonthlyJobCount(userId);
    if (usedThisMonth >= FREE_MONTHLY_LIMIT) {
      await fs.remove(req.file.path).catch(() => {});
      return res.status(402).json({
        error:           'Monthly limit reached',
        detail:          `Free accounts are limited to ${FREE_MONTHLY_LIMIT} files per month. Upgrade to continue processing.`,
        usedThisMonth,
        limit:           FREE_MONTHLY_LIMIT,
        upgradeRequired: true,
      });
    }
  }
  // ── End enforcement ───────────────────────────────────────────────────────

  const { title, description, tags, artist, genre, lyrics, platform = 'General' } = req.body;
  const inputPath  = req.file.path;
  const ext        = path.extname(req.file.originalname).toLowerCase() || '.mp3';
  const outputPath = path.join('uploads', `out_${Date.now()}${ext}`);

  try {
    await fs.copy(inputPath, outputPath);
  } catch (err) {
    await fs.remove(inputPath).catch(() => {});
    return res.status(500).json({ error: 'File copy failed' });
  }

  try {
    // Phase 1: Forensic before-state
    const beforeTags = await exiftool.read(outputPath);
    const beforeKeys = new Set(Object.keys(beforeTags));

    // Phase 2: Nuclear wipe
    try {
      await exiftool.execute('-all=', '-XMP:all=', '-IPTC:all=', '-overwrite_original', outputPath);
    } catch (wipeErr) {
      console.warn('Primary metadata wipe failed, retrying with exiftool.write fallback:', wipeErr.message);
      await exiftool.write(
        outputPath,
        {},
        ['-all=', '-XMP:all=', '-IPTC:all=', '-overwrite_original']
      );
    }

    // Phase 3: Platform-aware SEO injection
    const tagsArray      = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const year           = new Date().getFullYear();
    const safeArtist     = (artist || 'Creator').substring(0, 255);
    const safeTitle      = (title  || 'Untitled').substring(0, 255);
    const safeDescription = (description || '').substring(0, 1000);
    const safeGenre      = (genre  || '').substring(0, 100);

    const metaToWrite = {
      Title:     safeTitle,
      Artist:    safeArtist,
      Copyright: `© ${year} ${safeArtist}`,
      Keywords:  tagsArray,
      Genre:     safeGenre,
    };

    switch (platform) {
      case 'YouTube':
        metaToWrite.Description = safeDescription;
        metaToWrite.Comment     = safeDescription;
        break;
      case 'Spotify':
      case 'Apple Music':
        metaToWrite.Description = safeDescription;
        metaToWrite.Album       = safeTitle;
        metaToWrite.Year        = year;
        if (lyrics) metaToWrite['Lyrics-eng'] = lyrics.substring(0, 5000);
        break;
      case 'TikTok':
        metaToWrite.Comment = `${safeTitle} ${tagsArray.map(t => `#${t.replace(/\s/g, '')}`).join(' ')}`.substring(0, 300);
        break;
      default:
        metaToWrite.Description = safeDescription;
        metaToWrite.Comment     = safeDescription;
    }

    await exiftool.write(outputPath, metaToWrite, ['-overwrite_original']);

    // Phase 4: Forensic diff
    const afterTags   = await exiftool.read(outputPath);
    const afterKeys   = new Set(Object.keys(afterTags));
    const removedKeys = [...beforeKeys].filter(k => !afterKeys.has(k));

    // Phase 5: Record job (AFTER processing – only count successful deliveries)
    try {
      db.prepare(
        'INSERT INTO jobs (user_id, filename, platform) VALUES (?, ?, ?)'
      ).run(userId, req.file.originalname, platform);
    } catch (dbErr) {
      console.error('Job record failed (non-fatal):', dbErr);
    }

    // Phase 6: Send file with usage headers
    const usedNow = getMonthlyJobCount(userId);
    res.setHeader('X-Forensic-Removed', removedKeys.length);
    res.setHeader('X-Forensic-Tags',    JSON.stringify(removedKeys.slice(0, 50)));
    res.setHeader('X-Forensic-Status',  'Sanitized');
    res.setHeader('X-Usage-This-Month', usedNow);
    res.setHeader('X-Usage-Limit',      userPlan === 'free' ? FREE_MONTHLY_LIMIT : 'unlimited');

    res.download(outputPath, `cleansed_${req.file.originalname}`, async (err) => {
      if (err) console.error('Download stream error:', err);
      await fs.remove(inputPath).catch(() => {});
      await fs.remove(outputPath).catch(() => {});
    });

  } catch (err) {
    console.error('Processing error:', err);
    res.status(500).json({ error: 'Processing failed', detail: err.message });
    await fs.remove(inputPath).catch(() => {});
    await fs.remove(outputPath).catch(() => {});
  }
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`SpectraCleanse backend on :${PORT}`));

process.on('exit',    () => { exiftool.end(); db.close(); });
process.on('SIGTERM', () => { exiftool.end(); db.close(); process.exit(0); });
