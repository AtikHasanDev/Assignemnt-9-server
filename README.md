# FixMate API

Express API for FixMate, a pay-after-completion repair service platform.

## Current progress

Part 1 includes the HTTP server, health endpoint, explicit CORS origin allowlist, Helmet response headers, JSON error responses, environment validation, and graceful shutdown. Database, authentication, service and booking APIs, uploads, and payments are not implemented yet.

## Run locally

Requires Node.js 22 or newer.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

GET http://localhost:5000/api/health returns the API service status. This endpoint currently checks HTTP availability only, not a database connection.

## Configuration

- PORT: HTTP port, default 5000.
- CLIENT_ORIGINS: comma-separated exact client origins; defaults to http://localhost:3000. No paths or trailing slashes.
- NODE_ENV: development or production.

Keep secrets in ignored .env files. MongoDB, BetterAuth, JWT, ImgBB, and Stripe test-mode configuration will be introduced with their integrations. BetterAuth and Stripe webhook handlers must be mounted before the JSON parser.

## Commands and packages

- npm run dev: restart on source edits.
- npm start: run the server.
- npm run check: syntax validation.
- Packages: Express, cors, dotenv, helmet.

## Deployment

Not deployed yet. Admin and test accounts have not been created. This directory is a separate Git repository and must be committed independently from the parent client project. The full milestone plan is in the client repository at docs/IMPLEMENTATION_PLAN.md.

