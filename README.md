# FixMate API

Express and MongoDB API for FixMate, a pay-after-completion repair service platform.

## Current progress

Parts 1–2 implement HTTP configuration, exact-origin CORS, Helmet, MongoDB connection pooling, application indexes, startup validation, readiness checks, and graceful database shutdown. Authentication, service/booking endpoints, uploads, payments, and seed records will follow in later parts.

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
