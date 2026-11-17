# CardSafe — Two-Way Debit & Credit Card Lost & Found Security Platform

CardSafe is a privacy-first, two-way lost-and-found security system designed to safely match lost debit and credit cards with finders without exposing sensitive banking credentials.

---

## 🛠️ Tech Stack
- **Frontend**: Clean Modern Web UI (vanilla HTML5, CSS3, JavaScript ES6)
- **Backend**: Node.js + Express (ES Modules)
- **Database**: PostgreSQL (Port 4365, database `cardsafe`)
- **Security**: JWT Authentication, bcrypt password hashing, Helmet, Rate Limiting, Zod schema validation

---

## 🚀 Quick Start

### 1. Launch Backend Server
Double-click `run_backend.bat` in the project root, or execute:
```bash
cd "CardSafe_backend_v1/CardSafe/backend"
npm run dev
```

The server starts on:
- **API Base**: `http://localhost:5000/api`
- **Health Check**: `http://localhost:5000/api/health`
- **Web App**: `http://localhost:5000` (also opens directly via `Cardsafe Frontend/index.html`)

### 2. Demo User Accounts
Two demo accounts are pre-seeded in the database:
- **Card Owner**: `user@demo.com` / `demo1234`
- **Card Finder**: `finder@demo.com` / `demo1234`

You can also click **👤 Autofill Demo Owner** or **🔎 Autofill Demo Finder** on the login page, or register a new user account.

---

## 🔑 Key Features & Security Architecture

1. **Two-Way Automated Matching Engine (`matching.js`)**:
   - Compares Bank Name (35%), Last 4 Digits (35%), Card Type (20%), and Location (10%).
   - Generates automated matches whenever score $\ge 70\%$, regardless of whether the lost card or found card was reported first.

2. **Ownership Verification with Private Transactions**:
   - Card owners verify ownership by matching the merchant name of a recent transaction (e.g., `Grocery Store`).
   - Finders never see transaction data or owner account details.

3. **End-to-End Secure Chat**:
   - Real-time in-app chat between card owners and finders within verified matches.
   - Allows safe recovery coordination without exposing phone numbers or emails.

4. **Zero Sensitive Data Storage**:
   - Card numbers (16 digits), CVVs, PINs, and OTPs are **never** collected or stored.
   - Only safe identifiers (`bank_name`, `card_type`, `last4`) are used for matching.

---

## 📡 API Endpoints

### Authentication
- `POST /api/auth/register` — Create new account
- `POST /api/auth/login` — Sign in and receive JWT token

### Cards & Lost Reports
- `POST /api/cards` — Register card
- `GET /api/cards/mine` — Retrieve user's registered cards
- `GET /api/cards/mine/transactions` — Retrieve user's card transactions
- `POST /api/cards/:id/lost` — Report card as lost & trigger matching

### Found Cards & Reports
- `POST /api/reports/found` — Report found card & trigger matching (also aliased at `/api/found-cards`)
- `GET /api/reports/matches` — List all matches for current user
- `GET /api/reports/stats` — Dashboard statistics (lost, found, match counts)
- `POST /api/reports/matches/:id/verify-transaction` — Verify card ownership
- `GET /api/reports/matches/:id/messages` — Read chat messages for a match
- `POST /api/reports/matches/:id/messages` — Send chat message for a match

### Notifications
- `GET /api/notifications` — Retrieve user notifications
- `PATCH /api/notifications/:id/read` — Mark notification as read
