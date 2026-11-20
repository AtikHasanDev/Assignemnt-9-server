# FixMate API

Backend for FixMate, a device and home appliance repair platform. Customers book repairs, technicians manage the work, and customers pay after completion.

## Links

- [Live website](https://fixmate-atikhasan.vercel.app)
- [Live API readiness](https://fixmate-api-atikhasan.onrender.com/api/ready)
- [Client repository](https://github.com/AtikHasanDev/Assignment-9)
- [Demo accounts and passwords](https://github.com/AtikHasanDev/Assignment-9#demo-accounts)

The API base URL is `https://fixmate-api-atikhasan.onrender.com`. The bare `/` route returns `404`; use `/api/ready` to check database connectivity. Render Free may take 50 seconds or more to wake after inactivity.

## Features

- BetterAuth email/password sessions and short-lived JWT authorization.
- Customer, technician, and administrator roles with ownership checks.
- Service management, admin approval, availability, search, filters, sorting, and pagination.
- Bookings with optional ImgBB damage photos and duplicate active-request protection.
- Technician job transitions, final pricing, and timestamped repair history.
- Stripe test Checkout after completion, signed webhooks, and duplicate-payment protection.
- Customer payment history, admin transactions, and role-specific dashboard statistics.
- Profile updates and authenticated ImgBB uploads for PNG, JPEG, and WebP images up to 5 MB.

## Technology

Node.js, Express 5, MongoDB, BetterAuth, JOSE (JWT), Stripe, ImgBB, Helmet, and CORS.

## Run locally

Requires Node.js 22+ and a MongoDB deployment. MongoDB Atlas is supported; payment fulfillment requires transaction support, such as a replica set.

```powershell
npm ci
Copy-Item .env.example .env
```

Copy the template only when `.env` does not already exist. Fill in your configuration, then run:

```powershell
npm run db:check
npm run dev
```

The API runs at `http://localhost:5000` by default. Allow your host through Atlas Network Access and give the database user read/write access to the configured database. Startup requires a working database and successful index initialization.

## Environment variables

Keep actual values in the ignored `.env` file or the hosting provider's environment settings.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development` locally; `production` on Render. |
| `PORT` | HTTP port; defaults to `5000`. |
| `CLIENT_ORIGINS` | Comma-separated allowed frontend origins, without paths or trailing slashes. |
| `MONGODB_URI` | MongoDB connection string. |
| `MONGODB_DB` | Database name; defaults to `fixmate`. |
| `BETTER_AUTH_URL` | Public authentication origin; local default is `http://localhost:5000`. |
| `BETTER_AUTH_SECRET` | Stable random authentication secret, at least 32 characters. |
| `JWT_SECRET` | Independent random JWT signing secret, at least 32 characters. |
| `IMGBB_API_KEY` | Server-side image upload key. |
| `STRIPE_SECRET_KEY` | Stripe test secret key (`sk_test_...`). |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the local listener or deployed endpoint. |
| `PAYMENT_CLIENT_ORIGIN` | Frontend origin used for Checkout return URLs. |
| `DNS_SERVERS` | Optional comma-separated DNS resolver IPs for local SRV resolution issues. |

Use `localhost` consistently for the local client and API. In production, the Next.js client proxies `/api/*` to Render, so `BETTER_AUTH_URL`, `CLIENT_ORIGINS`, and `PAYMENT_CLIENT_ORIGIN` use `https://fixmate-atikhasan.vercel.app`. This keeps authentication cookies on the frontend domain.

## API overview

Paths are relative to the API base URL. Private business routes require a Bearer JWT; the server checks the current database role and record ownership.

| Area | Routes |
| --- | --- |
| Health | `GET /api/health` (process liveness), `GET /api/ready` (database readiness). |
| Authentication | `/api/auth/*` for BetterAuth; `POST /api/token` exchanges a valid session from a trusted origin for a JWT; `GET /api/me` returns the current account. |
| Public services | `GET /api/services`, `GET /api/services/:id`. |
| Technician services | `POST /api/services`, `GET /api/services/my`, `PATCH /api/services/:id`, `PATCH /api/services/:id/availability`, `DELETE /api/services/:id`. |
| Bookings | `POST /api/bookings`, `GET /api/bookings/my`, `GET /api/bookings/technician`, `PATCH /api/bookings/:id/cancel`, `PATCH /api/bookings/:id/status`. |
| Administration | User lists/role changes, service moderation, and booking monitoring under `/api/admin`. |
| Payments | `POST /api/payments/checkout`, `POST /api/payments/verify`, `POST /api/payments/webhook`, `GET /api/payments/my`, `GET /api/admin/transactions`. |
| Profiles and uploads | `PATCH /api/users/profile`, `POST /api/uploads`. |
| Dashboards | `GET /api/dashboard/customer`, `GET /api/dashboard/technician`, `GET /api/dashboard/admin`. |

Only approved, available services are publicly visible. New or fully edited services require admin approval. Customers can cancel requested bookings; technicians progress jobs through acceptance, repair, and completion. Payment opens only after completion and final pricing.

MongoDB indexes enforce unique account emails, one active request per customer/service pair, and unique payment identifiers. Payment fulfillment uses a transaction so repeated callbacks cannot create duplicate payments.

## Stripe test payments

Use test-mode keys only. The local listener script uses the official Stripe CLI. On Windows, install its cached package if needed:

```powershell
npm install --prefix node_modules/.cache/stripe-cli --no-package-lock --no-save @stripe/cli
npm run stripe:listen
```

The listener saves its signing secret to the ignored `.env`; restart the API to load it. On other platforms, set `STRIPE_CLI_PATH` to your official CLI executable. The script forwards events to `http://localhost:5000/api/payments/webhook`.

The deployed endpoint is `https://fixmate-api-atikhasan.onrender.com/api/payments/webhook`. It handles `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Configure its own signing secret in Render; it differs from the local listener secret. Checkout amounts use USD.

## Demo data

The seed provides four demo accounts, 21 approved services across seven categories, and six connected bookings. Preview before applying:

```powershell
npm run seed:demo
npm run seed:demo -- --apply
```

The seed preserves existing seeded edits and payments. Generated login details are stored in the ignored `.env.demo`; retain that file for subsequent seed runs and workflow checks. Public assignment login details are listed in the [client README](https://github.com/AtikHasanDev/Assignment-9#demo-accounts).

## Checks

```powershell
npm run check
npm test
npm run db:check
```

`check` validates JavaScript syntax, `test` runs the automated test suite, and `db:check` verifies the configured database and indexes.

Optional integration checks:

```powershell
npm run stripe:check
npm run demo:check
```

These require configured external services. `stripe:check` creates, verifies, and expires an unpaid test Checkout session. `demo:check` uses seeded accounts and `.env.demo` to exercise role-based workflows, creates temporary records, and cleans them up.

## Render deployment

- Branch: `main`.
- Build command: `npm ci`.
- Start command: `npm start`.
- Health check: `/api/ready`.
- Set production environment variables in Render, then deploy the intended commit.

This server is a separate Git repository from the client. Keep private database, authentication, image upload, and Stripe secrets out of Git and frontend environment variables.
