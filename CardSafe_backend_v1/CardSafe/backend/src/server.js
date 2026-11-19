import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import cardRoutes from './routes/cards.js';
import reportRoutes from './routes/reports.js';
import notificationRoutes from './routes/notifications.js';
import { query } from './config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();

// Disable CSP restriction for inline scripts and styles
app.use(helmet({ contentSecurityPolicy: false }));

// Allow all origins (for local and cloud requests)
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: '100kb' }));

// Development / production rate limiting
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const result = await query('SELECT 1 as connected');
    res.json({
      ok: true,
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      database: 'unavailable',
      error: err.message
    });
  }
});

// Primary API routes
app.use('/api/auth', authRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);

// Compatibility aliases for frontend endpoints
app.post('/api/found-cards', (req, res, next) => {
  req.url = '/found';
  reportRoutes(req, res, next);
});

app.use('/api/matches', reportRoutes);

// Serve frontend statically
const publicDir = path.resolve(__dirname, '../public');
const legacyFrontendDir = path.resolve(__dirname, '../../../../Cardsafe Frontend');

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}
if (fs.existsSync(legacyFrontendDir)) {
  app.use(express.static(legacyFrontendDir));
}

// Fallback to index.html for SPA-like navigation
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const indexPublic = path.join(publicDir, 'index.html');
  const indexLegacy = path.join(legacyFrontendDir, 'index.html');
  if (fs.existsSync(indexPublic)) {
    return res.sendFile(indexPublic);
  } else if (fs.existsSync(indexLegacy)) {
    return res.sendFile(indexLegacy);
  }
  next();
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('API Error:', err);
  res.status(500).json({ message: err.message || 'Internal server error' });
});

// Automatic schema & seed initialization on startup
async function initDatabase() {
  try {
    // 1. Run migrations for new columns and tables (Idempotent)
    await query(`
      CREATE TABLE IF NOT EXISTS verification_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(64) UNIQUE NOT NULL,
        code VARCHAR(12) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        is_used BOOLEAN NOT NULL DEFAULT FALSE,
        used_at TIMESTAMPTZ,
        used_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE IF EXISTS cards ADD COLUMN IF NOT EXISTS owner_name VARCHAR(120);
      ALTER TABLE IF EXISTS lost_card_reports ADD COLUMN IF NOT EXISTS owner_name VARCHAR(120);
      ALTER TABLE IF EXISTS found_card_reports ADD COLUMN IF NOT EXISTS owner_name VARCHAR(120);
      ALTER TABLE IF EXISTS found_card_reports ADD COLUMN IF NOT EXISTS expiry_date VARCHAR(20);
    `);

    // 2. Full schema check if initial setup
    const schemaPaths = [
      path.resolve(__dirname, '../database/schema.sql'),
      path.resolve(__dirname, '../../database/schema.sql'),
      path.resolve(__dirname, '../schema.sql')
    ];
    let schemaSql = null;
    for (const p of schemaPaths) {
      if (fs.existsSync(p)) {
        schemaSql = fs.readFileSync(p, 'utf8');
        break;
      }
    }
    if (schemaSql) {
      await query(schemaSql);
      console.log('✅ Database schema verified/initialized');
    }

    const userCount = await query('SELECT COUNT(*)::int as count FROM users');
    if (userCount.rows[0].count === 0) {
      const hash = await bcrypt.hash('demo1234', 12);
      await query(`
        INSERT INTO users (name, email, password_hash, role)
        VALUES ('Demo User', 'user@demo.com', $1, 'USER'),
               ('Finder Demo', 'finder@demo.com', $1, 'USER')
        ON CONFLICT DO NOTHING
      `, [hash]);
      console.log('✅ Default demo accounts seeded');
    }
  } catch (err) {
    console.log('Database init notice:', err.message);
  }
}

const port = process.env.PORT || 5000;
app.listen(port, async () => {
  console.log(`✅ CardSafe API & Web Server running on http://localhost:${port}`);
  console.log(`✅ Database target: ${process.env.DATABASE_URL ? 'Configured' : 'Missing'}`);
  await initDatabase();
});
