import { Router } from 'express';
import { z } from 'zod';
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
  description: z.string().max(1000).optional()
});

// Submit found card report
r.post('/found', auth, async (req, res) => {
  try {
    const d = foundSchema.parse(req.body);
    const report = (await query(
      `INSERT INTO found_card_reports(finder_id, bank_name, card_type, last4, found_location, found_at, description)
       VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.id, d.bankName, d.cardType, d.last4, d.foundLocation, d.foundAt, d.description || null]
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
             l.lost_location, l.lost_at, l.owner_id,
             f.found_location, f.found_at, f.finder_id, f.bank_name, f.card_type, f.last4
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
             l.lost_location, l.lost_at, l.owner_id,
             f.found_location, f.found_at, f.finder_id, f.bank_name, f.card_type, f.last4
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

// Verify recent transaction
r.post('/matches/:id/verify-transaction', auth, async (req, res) => {
  try {
    const d = z.object({
      merchantName: z.string().min(1).max(160)
    }).parse(req.body);

    const m = (await query(`
      SELECT m.*, l.owner_id, l.card_id, f.finder_id, f.bank_name, f.last4
      FROM matches m
      JOIN lost_card_reports l ON l.id = m.lost_report_id
      JOIN found_card_reports f ON f.id = m.found_report_id
      WHERE m.id = $1 AND l.owner_id = $2
    `, [req.params.id, req.user.id])).rows[0];

    if (!m) return res.status(404).json({ message: 'Match not found or you are not the card owner' });

    const tx = (await query(
      `SELECT merchant_name FROM transactions WHERE card_id = $1 ORDER BY transaction_date DESC LIMIT 10`,
      [m.card_id]
    )).rows;

    const normalized = d.merchantName.trim().toLowerCase();
    const verified = tx.some(t => t.merchant_name.toLowerCase().includes(normalized) || normalized.includes(t.merchant_name.toLowerCase()));

    if (verified) {
      await query("UPDATE matches SET status='OWNER_VERIFIED' WHERE id=$1", [m.id]);
      await query("UPDATE lost_card_reports SET status='RECOVERY_IN_PROGRESS' WHERE id=$1", [m.lost_report_id]);
      await query("UPDATE found_card_reports SET status='MATCHED' WHERE id=$1", [m.found_report_id]);

      await query(
        `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
        [req.user.id, 'Ownership Verified!', `Your ownership for ${m.bank_name} (...${m.last4}) was successfully verified.`]
      );

      if (m.finder_id) {
        await query(
          `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
          [m.finder_id, 'Owner Verified', `The owner has verified ownership of the ${m.bank_name} card. You can coordinate safe return via chat.`]
        );
      }
    }

    res.json({
      verified,
      status: verified ? 'OWNER_VERIFIED' : 'VERIFICATION_FAILED',
      message: verified ? 'Ownership successfully verified!' : 'Merchant name did not match recent transactions on file.'
    });
  } catch (e) {
    res.status(400).json({ message: e.message });
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
