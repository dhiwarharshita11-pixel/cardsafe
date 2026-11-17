CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'USER' CHECK (role IN ('USER','ADMIN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_name VARCHAR(120) NOT NULL,
  card_type VARCHAR(30) NOT NULL,
  last4 CHAR(4) NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lost_card_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lost_location VARCHAR(255) NOT NULL,
  lost_at TIMESTAMPTZ NOT NULL,
  description TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'LOST',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS found_card_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finder_id UUID REFERENCES users(id) ON DELETE SET NULL,
  bank_name VARCHAR(120) NOT NULL,
  card_type VARCHAR(30) NOT NULL,
  last4 CHAR(4) NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  found_location VARCHAR(255) NOT NULL,
  found_at TIMESTAMPTZ NOT NULL,
  description TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'REPORTED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  merchant_name VARCHAR(160) NOT NULL,
  transaction_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lost_report_id UUID NOT NULL REFERENCES lost_card_reports(id) ON DELETE CASCADE,
  found_report_id UUID NOT NULL REFERENCES found_card_reports(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  status VARCHAR(40) NOT NULL DEFAULT 'VERIFICATION_PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lost_report_id, found_report_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards(owner_id);
CREATE INDEX IF NOT EXISTS idx_lost_status ON lost_card_reports(status);
CREATE INDEX IF NOT EXISTS idx_found_status ON found_card_reports(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
