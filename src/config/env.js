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

const mongodbUri = process.env.MONGODB_URI?.trim() || '';
if (mongodbUri && !/^mongodb(?:\+srv)?:\/\//.test(mongodbUri)) {
  throw new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://.');
}
const mongodbDb = process.env.MONGODB_DB?.trim() || 'fixmate';
if (!/^[a-zA-Z0-9_-]+$/.test(mongodbDb) || Buffer.byteLength(mongodbDb) >= 64) {
  throw new Error('MONGODB_DB must be shorter than 64 bytes and contain only letters, numbers, underscores, or hyphens.');
}

const authUrl = process.env.BETTER_AUTH_URL || 'http://localhost:5000';
if (new URL(authUrl).origin !== authUrl) throw new Error('BETTER_AUTH_URL must be an exact origin without a trailing slash.');

export const env = Object.freeze({
  stripeSecret: process.env.STRIPE_SECRET_KEY?.trim() || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || '',
  paymentOrigin: process.env.PAYMENT_CLIENT_ORIGIN || clientOrigins[0],
  imgbbKey: process.env.IMGBB_API_KEY || '',
  jwtSecret: process.env.JWT_SECRET || '',
  authUrl,
  authSecret: process.env.BETTER_AUTH_SECRET || '',
  mongodbUri,
  mongodbDb,
  port,
  clientOrigins,
  isProduction: process.env.NODE_ENV === 'production',
});
