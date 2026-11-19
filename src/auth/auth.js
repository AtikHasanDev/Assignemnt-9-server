import { betterAuth } from 'better-auth';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { env } from '../config/env.js';
import { getDatabase, getMongoClient } from '../db/mongodb.js';
import { registrationRole, validatePassword } from './policy.js';

export function createAuth() {
  if (!env.authSecret || env.authSecret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
  return betterAuth({
    appName: 'FixMate', baseURL: env.authUrl, secret: env.authSecret,
    database: mongodbAdapter(getDatabase(), { client: getMongoClient() }),
    trustedOrigins: env.clientOrigins,
    emailAndPassword: { enabled: true, minPasswordLength: 6, maxPasswordLength: 128 },
    user: { additionalFields: {
      role: { type: 'string', required: false, defaultValue: 'customer', input: false },
      phone: { type: 'string', required: false, defaultValue: '' },
      area: { type: 'string', required: false, defaultValue: '' },
      bio: { type: 'string', required: false, defaultValue: '' },
    } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    hooks: { before: createAuthMiddleware(async ctx => {
      if (ctx.path === '/sign-up/email') {
        validatePassword(ctx.body?.password);
        if (typeof ctx.body?.name !== 'string' || !ctx.body.name.trim()) throw new APIError('BAD_REQUEST', { message: 'Name is required.' });
      }
      if (ctx.path === '/change-password' || ctx.path === '/reset-password') validatePassword(ctx.body?.newPassword);
      if (ctx.path === '/update-user' && Object.hasOwn(ctx.body || {}, 'role')) {
        throw new APIError('FORBIDDEN', { message: 'Roles cannot be changed through profile updates.' });
      }
    }) },
    databaseHooks: { user: { create: { before: async (user, ctx) => ({ data: {
      ...user, email: user.email.toLowerCase().trim(),
      role: ctx?.path === '/sign-up/email' ? registrationRole(ctx.body?.role) : 'customer',
    } }) } } },
    rateLimit: { enabled: true, window: 60, max: 60 },
    logger: { level: 'error' },
  });
}

