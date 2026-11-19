# FixMate API

Express and MongoDB API for FixMate, a pay-after-completion repair service platform.

## Current progress

Parts 1–3 implement HTTP configuration, CORS, MongoDB and indexes, readiness checks, and BetterAuth email/password endpoints mounted before JSON parsing. Registration accepts customer or technician roles; invalid roles become customer. Role is server-owned and cannot be changed through profile updates. Passwords require six characters plus uppercase and lowercase letters. Service/booking endpoints, JWT authorization, uploads, payments, and seed records follow in later parts.

Authentication requires BETTER_AUTH_URL (the exact API origin) and BETTER_AUTH_SECRET (a random secret of at least 32 characters) in the ignored .env. Keep this secret stable across restarts. The client sends credentialed requests to NEXT_PUBLIC_API_URL. Use localhost for both client and server during development; mixing localhost and 127.0.0.1 can prevent cookies from working. Production origins must be added to CLIENT_ORIGINS and deployment must support credential cookies between client and API.

Optional DNS_SERVERS is a comma-separated list of DNS resolver IPs. It affects only this Node process and can resolve local SRV lookup failures; leave it blank when the system resolver works. Local DNS overrides and actual secrets belong in .env only.

## Local setup

Requires Node.js 22+ and MongoDB 6.0+ (Atlas supported).

```powershell
npm install
# Only if .env does not already exist:
Copy-Item .env.example .env
# Edit .env locally and add your Atlas URI. Do not commit it.
npm run db:check
npm run dev
```

Configuration:
- PORT: HTTP port, default 5000.
- CLIENT_ORIGINS: comma-separated exact origins, no paths or trailing slashes.
- MONGODB_URI: required Atlas/standard MongoDB connection string. URL-encode special characters in the database password.
- MONGODB_DB: database name, default fixmate.
- NODE_ENV: development or production.

Use an Atlas database user with read/write access to the chosen database and allow the development/deployment host through Atlas Network Access. Do not paste connection strings into chat, logs, or Git. Startup fails without a working database and successful index initialization; it never silently falls back to sample data.

## Health and readiness

- GET /api/health: HTTP process liveness only, returns 200 while the server is running.
- GET /api/ready: performs a database ping; returns 200 when connected and 503 when unavailable. It does not expose hostnames or credentials.

## Data model and indexes

There are four application collections: user (BetterAuth's default identity collection), services, bookings, and payments. BetterAuth will create its own session/account/verification collections later. Do not create a parallel users collection.

- user: unique email and role/creation-time index.
- services: public availability/approval/newest, category/mode/price, and technician indexes.
- bookings: a partial unique customerEmail + serviceId index applies only to requested, accepted, and in-progress records. Concurrent duplicate active requests are rejected by MongoDB. Customer history, technician queues, and admin status queries are indexed.
- payments: unique bookingId, stripeSessionId, and transactionId; customer, technician, and chronological transaction indexes.

Index initialization is repeatable and does not remove existing data or silently drop indexes. Existing duplicates or incompatible index definitions stop startup and must be investigated. Later API steps must translate duplicate-key errors into user-friendly conflict messages and normalize account emails consistently.

## Validation

Part 5 exposes public GET /api/services and GET /api/services/:id. Listings accept search, category, serviceMode, sort (newest, price-asc, price-desc), page, and limit (1–48). Search is a literal, case-insensitive MongoDB regex on title/category. Filtering, sorting, counts, skip, and limit happen in MongoDB. Only approved and available services are returned; unavailable/missing details return 404. Technician details expose only name, image, area, and bio. No data is seeded by these routes.

Part 4 adds POST /api/token (valid BetterAuth session plus trusted Origin required) and GET /api/me (Bearer JWT required). JWTs expire after 15 minutes and validate HS256, issuer, audience, subject, and account existence. Set an independent JWT_SECRET of at least 32 random characters in .env; a local value has been generated during development. Never commit actual secrets.

createAuthorization provides verifyToken, verifyCustomer, verifyTechnician, and verifyAdmin. Private business routes added in later parts must apply verifyToken before the appropriate role middleware and scope database queries to req.user. Roles are loaded from MongoDB on each request. The JWT suite verifies missing/invalid/expired/wrong-key tokens, role changes, and deleted users.

```powershell
npm run check
npm test
npm run db:check
```

The unit tests verify readiness/liveness behavior and error redaction without an Atlas connection. db:check requires actual configuration, initializes the real application indexes, and lists their names. Unit tests alone do not verify MongoDB's unique constraints.

MongoDB design follows the [Node driver connection guidance](https://www.mongodb.com/docs/drivers/node/current/connect/mongoclient/) and [partial unique index documentation](https://www.mongodb.com/docs/manual/core/index-partial/).

## Packages and deployment

Packages: Express, cors, dotenv, helmet, mongodb.

Not deployed. Admin and test accounts have not been created. BetterAuth and Stripe raw-body handlers must be mounted before JSON parsing when implemented. This directory is a separate Git repository and is committed independently from the parent client. Actual .env files remain ignored.
