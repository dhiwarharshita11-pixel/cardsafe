import bcrypt from 'bcryptjs';
import { pool, query } from './config/db.js';

async function seed() {
  console.log('--- Starting CardSafe Seeding ---');

  // 1. Create or update user@demo.com
  const passwordHash = await bcrypt.hash('demo1234', 12);
  const userRes = await query(`
    INSERT INTO users (name, email, password_hash, role)
    VALUES ('Demo User', 'user@demo.com', $1, 'USER')
    ON CONFLICT (email) DO UPDATE SET password_hash = $1, name = 'Demo User'
    RETURNING id, name, email;
  `, [passwordHash]);
  const user = userRes.rows[0];
  console.log('Created/Updated user:', user.email);

  // 2. Create or update finder@demo.com
  const finderRes = await query(`
    INSERT INTO users (name, email, password_hash, role)
    VALUES ('Finder Demo', 'finder@demo.com', $1, 'USER')
    ON CONFLICT (email) DO UPDATE SET password_hash = $1, name = 'Finder Demo'
    RETURNING id, name, email;
  `, [passwordHash]);
  const finder = finderRes.rows[0];
  console.log('Created/Updated finder:', finder.email);

  // 3. Ensure a demo card exists for user
  let cardRes = await query(`SELECT * FROM cards WHERE owner_id = $1 AND last4 = '4821'`, [user.id]);
  let card;
  if (cardRes.rows.length === 0) {
    const newCard = await query(`
      INSERT INTO cards (owner_id, bank_name, card_type, last4, status)
      VALUES ($1, 'State Bank of India', 'DEBIT', '4821', 'ACTIVE')
      RETURNING *
    `, [user.id]);
    card = newCard.rows[0];
    console.log('Created demo card for user:', card.bank_name, card.last4);
  } else {
    card = cardRes.rows[0];
  }

  // 4. Ensure demo transactions exist for card
  const txRes = await query(`SELECT * FROM transactions WHERE card_id = $1`, [card.id]);
  if (txRes.rows.length === 0) {
    await query(`
      INSERT INTO transactions (card_id, merchant_name, transaction_date, amount)
      VALUES 
        ($1, 'Grocery Store', CURRENT_DATE - INTERVAL '1 day', 450.00),
        ($1, 'College Canteen', CURRENT_DATE - INTERVAL '2 days', 120.00),
        ($1, 'Online Purchase', CURRENT_DATE - INTERVAL '3 days', 899.00)
    `, [card.id]);
    console.log('Created sample transactions for card:', card.id);
  }

  console.log('--- Seeding Completed Successfully! ---');
  await pool.end();
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
