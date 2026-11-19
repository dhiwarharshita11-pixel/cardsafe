import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { query } from '../config/db.js';
import { auth } from '../middleware/auth.js';
import { matchFoundReport } from '../services/matching.js';

const r = Router();

const foundSchema = z.object({
  bankName: z.string().min(2),
  cardType: z.enum(['DEBIT', 'CREDIT']),
  last4: z.string().regex(/^\d{4}$/),
  foundLocation: z.string().min(2).max(255),
  foundAt: z.string(),
  description: z.string().max(1000).optional(),
  ownerName: z.string().max(120).optional(),
  expiryDate: z.string().max(20).optional()
});

// Submit found card report
r.post('/found', auth, async (req, res) => {
  try {
    const d = foundSchema.parse(req.body);
    const report = (await query(
      `INSERT INTO found_card_reports(finder_id, bank_name, card_type, last4, found_location, found_at, description, owner_name, expiry_date)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.user.id, d.bankName, d.cardType, d.last4, d.foundLocation, d.foundAt, d.description || null, d.ownerName || null, d.expiryDate || null]
    )).rows[0];

    const matches = await matchFoundReport(report.id);
    res.status(201).json({ report, matches, matchCreated: matches.length > 0 });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// Get user's matches
r.get('/matches', auth, async (req, res) => {
  try {
    const rows = (await query(`
      SELECT m.*,
             l.lost_location, l.lost_at, l.owner_id, l.owner_name as lost_owner_name, l.expiry_date as lost_expiry_date,
             f.found_location, f.found_at, f.finder_id, f.bank_name, f.card_type, f.last4,
             f.owner_name as found_owner_name, f.expiry_date as found_expiry_date,
             COALESCE(f.expiry_date, l.expiry_date) as expiry_date
      FROM matches m
      JOIN lost_card_reports l ON l.id = m.lost_report_id
      JOIN found_card_reports f ON f.id = m.found_report_id
      WHERE l.owner_id = $1 OR f.finder_id = $1
      ORDER BY m.created_at DESC
    `, [req.user.id])).rows;

    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Alias for /matches/mine
r.get('/matches/mine', auth, async (req, res) => {
  try {
    const rows = (await query(`
      SELECT m.*,
             l.lost_location, l.lost_at, l.owner_id, l.owner_name as lost_owner_name, l.expiry_date as lost_expiry_date,
             f.found_location, f.found_at, f.finder_id, f.bank_name, f.card_type, f.last4,
             f.owner_name as found_owner_name, f.expiry_date as found_expiry_date,
             COALESCE(f.expiry_date, l.expiry_date) as expiry_date
      FROM matches m
      JOIN lost_card_reports l ON l.id = m.lost_report_id
      JOIN found_card_reports f ON f.id = m.found_report_id
      WHERE l.owner_id = $1 OR f.finder_id = $1
      ORDER BY m.created_at DESC
    `, [req.user.id])).rows;

    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Dashboard statistics
r.get('/stats', auth, async (req, res) => {
  try {
    const lostRes = await query(
      'SELECT COUNT(*)::int AS count FROM lost_card_reports WHERE owner_id = $1',
      [req.user.id]
    );
    const foundRes = await query(
      'SELECT COUNT(*)::int AS count FROM found_card_reports WHERE finder_id = $1',
      [req.user.id]
    );
    const matchesRes = await query(`
      SELECT COUNT(*)::int AS count
      FROM matches m
      JOIN lost_card_reports l ON l.id = m.lost_report_id
      JOIN found_card_reports f ON f.id = m.found_report_id
      WHERE l.owner_id = $1 OR f.finder_id = $1
    `, [req.user.id]);

    res.json({
      lostCount: lostRes.rows[0].count,
      foundCount: foundRes.rows[0].count,
      matchesCount: matchesRes.rows[0].count
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// --- UNIQUE QR VERIFICATION CODE SYSTEM ---

// 1. Generate QR Code / Single-Use Token (Card Owner)
r.post('/matches/:id/generate-qr', auth, async (req, res) => {
  try {
    // Verify user is the card owner of this match
    const match = (await query(`
      SELECT m.id, m.status, l.owner_id, f.finder_id, f.bank_name, f.last4
      FROM matches m
      JOIN lost_card_reports l ON l.id = m.lost_report_id
      JOIN found_card_reports f ON f.id = m.found_report_id
      WHERE m.id = $1 AND l.owner_id = $2
    `, [req.params.id, req.user.id])).rows[0];

    if (!match) {
      return res.status(403).json({ message: 'Only the verified card owner can generate a handover QR code.' });
    }

    // Invalidate any previously un-used tokens for this match
    await query(`
      UPDATE verification_tokens
      SET is_used = TRUE
      WHERE match_id = $1 AND is_used = FALSE
    `, [match.id]);

    // Generate cryptographically random secure token
    const token = crypto.randomBytes(20).toString('hex');
    // Human-readable 6-character code (e.g. CS-7429)
    const code = 'CS-' + Math.floor(1000 + Math.random() * 9000);
    // 30 minutes validity
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const inserted = (await query(`
      INSERT INTO verification_tokens (match_id, owner_id, token, code, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, token, code, expires_at
    `, [match.id, req.user.id, token, code, expiresAt])).rows[0];

    // Notification to Finder that owner generated verification code
    if (match.finder_id) {
      await query(`
        INSERT INTO notifications (user_id, title, message)
        VALUES ($1, $2, $3)
      `, [match.finder_id, 'Handover QR Ready', `The owner has generated a handover verification code for the ${match.bank_name} card.`]);
    }

    res.status(201).json({
      success: true,
      token: inserted.token,
      code: inserted.code,
      expiresAt: inserted.expires_at,
      validMinutes: 30
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// 2. Verify Scanned QR / Token (Finder or Participant)
r.post('/matches/:id/verify-qr', auth, async (req, res) => {
  try {
    const d = z.object({
      code: z.string().min(3).max(64)
    }).parse(req.body);

    const match = (await query(`
      SELECT m.id, m.lost_report_id, m.found_report_id, l.owner_id, f.finder_id, f.bank_name, f.last4
      FROM matches m
      JOIN lost_card_reports l ON l.id = m.lost_report_id
      JOIN found_card_reports f ON f.id = m.found_report_id
      WHERE m.id = $1 AND (l.owner_id = $2 OR f.finder_id = $2)
    `, [req.params.id, req.user.id])).rows[0];

    if (!match) {
      return res.status(404).json({ message: 'Match not found or access denied.' });
    }

    const cleanInput = d.code.trim();

    // Look up active token for this match
    const tokenRecord = (await query(`
      SELECT * FROM verification_tokens
      WHERE match_id = $1 AND (token = $2 OR UPPER(code) = UPPER($2))
      ORDER BY created_at DESC LIMIT 1
    `, [match.id, cleanInput])).rows[0];

    if (!tokenRecord) {
      return res.status(400).json({ verified: false, message: 'Invalid QR code or verification token.' });
    }

    if (tokenRecord.is_used) {
      return res.status(400).json({ verified: false, message: 'This single-use QR token has already been used.' });
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      return res.status(400).json({ verified: false, message: 'This QR code has expired. Please ask the owner to generate a fresh one.' });
    }

    // Mark token as used (single-use enforcement)
    await query(`
      UPDATE verification_tokens
      SET is_used = TRUE, used_at = NOW(), used_by = $1
      WHERE id = $2
    `, [req.user.id, tokenRecord.id]);

    // Update match and report statuses to HANDOVER_VERIFIED
    await query("UPDATE matches SET status='HANDOVER_VERIFIED' WHERE id=$1", [match.id]);
    await query("UPDATE lost_card_reports SET status='RETURNED' WHERE id=$1", [match.lost_report_id]);
    await query("UPDATE found_card_reports SET status='RETURNED' WHERE id=$1", [match.found_report_id]);

    // Send notifications to both participants
    await query(`
      INSERT INTO notifications (user_id, title, message)
      VALUES 
        ($1, '🎉 Handover Verified!', 'Your card handover has been successfully verified via single-use QR verification. Thank you for using CardSafe!'),
        ($2, '🎉 Card Handover Complete!', 'The card handover has been verified and completed successfully. Thank you for your honesty!')
    `, [match.owner_id, match.finder_id]);

    res.json({
      verified: true,
      status: 'HANDOVER_VERIFIED',
      message: '✅ Card Handover Verified Successfully! Single-use token confirmed.'
    });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// 3. Check QR Verification Status in real-time
r.get('/matches/:id/qr-status', auth, async (req, res) => {
  try {
    const match = (await query(`
      SELECT m.id, m.status,
             (SELECT is_used FROM verification_tokens WHERE match_id = m.id ORDER BY created_at DESC LIMIT 1) as is_token_used
      FROM matches m
      WHERE m.id = $1
    `, [req.params.id])).rows[0];

    if (!match) return res.status(404).json({ message: 'Match not found' });

    res.json({
      status: match.status,
      isVerified: match.status === 'HANDOVER_VERIFIED',
      isTokenUsed: !!match.is_token_used
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Chat messages for a match
r.get('/matches/:id/messages', auth, async (req, res) => {
  try {
    const match = (await query(`
      SELECT m.id FROM matches m
      JOIN lost_card_reports l ON l.id = m.lost_report_id
      JOIN found_card_reports f ON f.id = m.found_report_id
      WHERE m.id = $1 AND (l.owner_id = $2 OR f.finder_id = $2)
    `, [req.params.id, req.user.id])).rows[0];

    if (!match) {
      return res.status(403).json({ message: 'Access denied: you are not a participant in this match' });
    }

    const messages = (await query(`
      SELECT msg.id, msg.match_id, msg.sender_id, msg.body, msg.created_at, u.name as sender_name
      FROM messages msg
      JOIN users u ON u.id = msg.sender_id
      WHERE msg.match_id = $1
      ORDER BY msg.created_at ASC
    `, [req.params.id])).rows;

    res.json(messages);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Post chat message in a match
r.post('/matches/:id/messages', auth, async (req, res) => {
  try {
    const bodySchema = z.object({
      body: z.string().min(1).max(2000)
    });
    const d = bodySchema.parse(req.body);

    const match = (await query(`
      SELECT m.id, l.owner_id, f.finder_id FROM matches m
      JOIN lost_card_reports l ON l.id = m.lost_report_id
      JOIN found_card_reports f ON f.id = m.found_report_id
      WHERE m.id = $1 AND (l.owner_id = $2 OR f.finder_id = $2)
    `, [req.params.id, req.user.id])).rows[0];

    if (!match) {
      return res.status(403).json({ message: 'Access denied: you are not a participant in this match' });
    }

    const newMsg = (await query(`
      INSERT INTO messages (match_id, sender_id, body)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.params.id, req.user.id, d.body.trim()])).rows[0];

    // Notify the other participant
    const otherUserId = (match.owner_id === req.user.id) ? match.finder_id : match.owner_id;
    if (otherUserId) {
      await query(`
        INSERT INTO notifications (user_id, title, message)
        VALUES ($1, $2, $3)
      `, [otherUserId, 'New Message in CardSafe Chat', `You received a new message regarding your card match.`]);
    }

    res.status(201).json(newMsg);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

export default r;
