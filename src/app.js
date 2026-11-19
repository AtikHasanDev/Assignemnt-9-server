import express from 'express';
import { toNodeHandler } from 'better-auth/node';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';

export function createApp({ checkDatabase = async () => false, auth } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || env.clientOrigins.includes(origin)) return callback(null, true);
      return callback(Object.assign(new Error('Origin is not allowed.'), { status: 403 }));
    },
  }));

  if (auth) app.all('/api/auth/*splat', toNodeHandler(auth));
  // Stripe raw-body handler must also be mounted before express.json.
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/health', (_req, res) => res.json({
    status: 'ok', service: 'fixmate-api', version: '0.1.0',
  }));
  // Liveness stays independent of MongoDB; readiness reflects a real ping.
  app.get('/api/ready', async (_req, res) => {
    try {
      const ready = await checkDatabase();
      res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable', database: ready ? 'connected' : 'unavailable' });
    } catch {
      res.status(503).json({ status: 'unavailable', database: 'unavailable' });
    }
  });
  app.use((_req, res) => res.status(404).json({ message: 'API route not found.' }));
  app.use((error, _req, res, _next) => {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ message: status >= 500 ? 'An unexpected server error occurred.' : error.message });
  });
  return app;
}
