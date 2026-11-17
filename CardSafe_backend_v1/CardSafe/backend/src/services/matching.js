import { query } from '../config/db.js';

export async function matchFoundReport(foundReportId) {
  const found = (await query('SELECT * FROM found_card_reports WHERE id=$1', [foundReportId])).rows[0];
  if (!found) return [];

  const lost = (await query(`
    SELECT l.*, c.bank_name, c.card_type, c.last4
    FROM lost_card_reports l
    JOIN cards c ON c.id=l.card_id
    WHERE l.status='LOST'
  `)).rows;

  const matches = [];
  for (const item of lost) {
    let score = 0;
    if (item.bank_name.trim().toLowerCase() === found.bank_name.trim().toLowerCase()) score += 35;
    if (item.card_type.trim().toLowerCase() === found.card_type.trim().toLowerCase()) score += 20;
    if (item.last4 === found.last4) score += 35;
    if (item.lost_location.trim().toLowerCase() === found.found_location.trim().toLowerCase()) score += 10;

    if (score >= 70) {
      const r = await query(`
        INSERT INTO matches(lost_report_id, found_report_id, score)
        VALUES($1, $2, $3)
        ON CONFLICT(lost_report_id, found_report_id)
        DO UPDATE SET score = EXCLUDED.score
        RETURNING *
      `, [item.id, found.id, score]);

      await query(`
        INSERT INTO notifications(user_id, title, message)
        VALUES($1, $2, $3)
      `, [
        item.owner_id,
        'Possible card match found',
        `A found-card report matched your ${item.bank_name} card with a ${score}% match score. Please verify ownership.`
      ]);

      if (found.finder_id) {
        await query(`
          INSERT INTO notifications(user_id, title, message)
          VALUES($1, $2, $3)
        `, [
          found.finder_id,
          'Potential card match found',
          `A lost-card report matches the ${found.bank_name} card you found (${score}% score).`
        ]);
      }

      matches.push(r.rows[0]);
    }
  }
  return matches;
}

export async function matchLostReport(lostReportId) {
  const lost = (await query(`
    SELECT l.*, c.bank_name, c.card_type, c.last4
    FROM lost_card_reports l
    JOIN cards c ON c.id=l.card_id
    WHERE l.id=$1
  `, [lostReportId])).rows[0];

  if (!lost) return [];

  const foundReports = (await query(`
    SELECT * FROM found_card_reports WHERE status IN ('REPORTED', 'SEARCHING')
  `)).rows;

  const matches = [];
  for (const found of foundReports) {
    let score = 0;
    if (lost.bank_name.trim().toLowerCase() === found.bank_name.trim().toLowerCase()) score += 35;
    if (lost.card_type.trim().toLowerCase() === found.card_type.trim().toLowerCase()) score += 20;
    if (lost.last4 === found.last4) score += 35;
    if (lost.lost_location.trim().toLowerCase() === found.found_location.trim().toLowerCase()) score += 10;

    if (score >= 70) {
      const r = await query(`
        INSERT INTO matches(lost_report_id, found_report_id, score)
        VALUES($1, $2, $3)
        ON CONFLICT(lost_report_id, found_report_id)
        DO UPDATE SET score = EXCLUDED.score
        RETURNING *
      `, [lost.id, found.id, score]);

      await query(`
        INSERT INTO notifications(user_id, title, message)
        VALUES($1, $2, $3)
      `, [
        lost.owner_id,
        'Possible card match found',
        `A found-card report matches your ${lost.bank_name} card with a ${score}% match score. Please verify ownership.`
      ]);

      if (found.finder_id) {
        await query(`
          INSERT INTO notifications(user_id, title, message)
          VALUES($1, $2, $3)
        `, [
          found.finder_id,
          'Potential owner found for card',
          `An owner reported a card matching the ${found.bank_name} card you found (${score}% score).`
        ]);
      }

      matches.push(r.rows[0]);
    }
  }
  return matches;
}
