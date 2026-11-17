import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { auth } from '../middleware/auth.js';
import { matchLostReport } from '../services/matching.js';

const r = Router();

const cardSchema = z.object({
  bankName: z.string().min(2),
  cardType: z.enum(['DEBIT', 'CREDIT']),
  last4: z.string().regex(/^\d{4}$/)
});

r.post('/', auth, async (req, res) => {
  try {
    const d = cardSchema.parse(req.body);
    const row = (await query(
      'INSERT INTO cards(owner_id, bank_name, card_type, last4) VALUES($1, $2, $3, $4) RETURNING id, bank_name, card_type, last4, status',
      [req.user.id, d.bankName, d.cardType, d.last4]
    )).rows[0];
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

r.get('/mine', auth, async (req, res) => {
  try {
    const rows = (await query(
      'SELECT id, bank_name, card_type, last4, status, created_at FROM cards WHERE owner_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    )).rows;
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Get all transactions for current user's cards
r.get('/mine/transactions', auth, async (req, res) => {
  try {
    const rows = (await query(`
      SELECT t.id, t.card_id, t.merchant_name, t.transaction_date, t.amount, t.created_at,
             c.bank_name, c.card_type, c.last4
      FROM transactions t
      JOIN cards c ON c.id = t.card_id
      WHERE c.owner_id = $1
      ORDER BY t.transaction_date DESC, t.created_at DESC
    `, [req.user.id])).rows;
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

r.post('/:id/lost', auth, async (req, res) => {
  try {
    const d = z.object({
      lostLocation: z.string().min(2).max(255),
      lostAt: z.string(),
      description: z.string().max(1000).optional(),
      merchantName: z.string().max(160).optional(),
      amount: z.union([z.number(), z.string()]).optional(),
      transactionDate: z.string().optional()
    }).parse(req.body);

    const c = (await query('SELECT * FROM cards WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id])).rows[0];
    if (!c) return res.status(404).json({ message: 'Card not found' });

    await query("UPDATE cards SET status='LOST' WHERE id=$1", [c.id]);

    const report = (await query(
      `INSERT INTO lost_card_reports(card_id, owner_id, lost_location, lost_at, description)
       VALUES($1, $2, $3, $4, $5) RETURNING *`,
      [c.id, req.user.id, d.lostLocation, d.lostAt, d.description || null]
    )).rows[0];

    // If owner provided recent transaction verification details, record into transactions table
    if (d.merchantName && d.merchantName.trim()) {
      const parsedAmount = d.amount ? parseFloat(d.amount) : 0;
      const txDate = d.transactionDate ? new Date(d.transactionDate) : new Date();
      await query(
        `INSERT INTO transactions (card_id, merchant_name, transaction_date, amount)
         VALUES ($1, $2, $3, $4)`,
        [c.id, d.merchantName.trim(), txDate, isNaN(parsedAmount) ? 0 : parsedAmount]
      );
    }

    // Two-way matching: check if anyone already reported this card as found
    const matches = await matchLostReport(report.id);

    res.status(201).json({ report, matches });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

export default r;
