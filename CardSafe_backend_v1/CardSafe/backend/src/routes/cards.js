import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { auth } from '../middleware/auth.js';
import { matchLostReport } from '../services/matching.js';

const r = Router();

const cardSchema = z.object({
  bankName: z.string().min(2),
  cardType: z.enum(['DEBIT', 'CREDIT']),
  last4: z.string().regex(/^\d{4}$/),
  ownerName: z.string().min(1).max(120).optional(),
  expiryDate: z.string().max(20).optional()
});

// Register card
r.post('/', auth, async (req, res) => {
  try {
    const d = cardSchema.parse(req.body);
    const row = (await query(
      'INSERT INTO cards(owner_id, bank_name, card_type, last4, owner_name, expiry_date) VALUES($1, $2, $3, $4, $5, $6) RETURNING id, bank_name, card_type, last4, owner_name, expiry_date, status',
      [req.user.id, d.bankName, d.cardType, d.last4, d.ownerName || null, d.expiryDate || null]
    )).rows[0];
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// Get user cards
r.get('/mine', auth, async (req, res) => {
  try {
    const rows = (await query(
      'SELECT id, bank_name, card_type, last4, owner_name, expiry_date, status, created_at FROM cards WHERE owner_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    )).rows;
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Report card as lost
r.post('/:id/lost', auth, async (req, res) => {
  try {
    const d = z.object({
      lostLocation: z.string().min(2).max(255),
      lostAt: z.string(),
      description: z.string().max(1000).optional(),
      ownerName: z.string().max(120).optional(),
      expiryDate: z.string().max(20).optional()
    }).parse(req.body);

    const c = (await query('SELECT * FROM cards WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id])).rows[0];
    if (!c) return res.status(404).json({ message: 'Card not found' });

    const effectiveOwnerName = d.ownerName || c.owner_name || null;
    const effectiveExpiry = d.expiryDate || c.expiry_date || null;

    await query(
      "UPDATE cards SET status='LOST', owner_name=COALESCE($2, owner_name), expiry_date=COALESCE($3, expiry_date) WHERE id=$1",
      [c.id, effectiveOwnerName, effectiveExpiry]
    );

    const report = (await query(
      `INSERT INTO lost_card_reports(card_id, owner_id, owner_name, expiry_date, lost_location, lost_at, description)
       VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [c.id, req.user.id, effectiveOwnerName, effectiveExpiry, d.lostLocation, d.lostAt, d.description || null]
    )).rows[0];

    // Two-way matching: check if anyone already reported this card as found
    const matches = await matchLostReport(report.id);

    res.status(201).json({ report, matches });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

export default r;
