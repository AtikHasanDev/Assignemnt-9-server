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

export const env = Object.freeze({
  mongodbUri,
  mongodbDb,
  port,
  clientOrigins,
  isProduction: process.env.NODE_ENV === 'production',
});
