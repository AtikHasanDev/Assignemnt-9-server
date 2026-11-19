import 'dotenv/config';

const port = Number(process.env.PORT || 5000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const clientOrigins = (process.env.CLIENT_ORIGINS || 'http://localhost:3000')
  .split(',').map(origin => origin.trim()).filter(Boolean);

for (const origin of clientOrigins) {
  if (new URL(origin).origin !== origin) throw new Error('CLIENT_ORIGINS must contain exact origins without paths or trailing slashes.');
}

export const env = Object.freeze({
  port,
  clientOrigins,
  isProduction: process.env.NODE_ENV === 'production',
});

