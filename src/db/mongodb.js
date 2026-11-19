import '../config/dns.js';
import { MongoClient } from 'mongodb';
import { env } from '../config/env.js';
import { collectionNames, ensureIndexes } from './indexes.js';

let client;
let database;
let connecting;

export async function connectDatabase() {
  if (database) return database;
  if (connecting) return connecting;
  if (!env.mongodbUri) throw new Error('Set MONGODB_URI in the server .env before starting the API.');
  connecting = (async () => {
    const candidate = new MongoClient(env.mongodbUri, {
      appName: 'fixmate-api', maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000,
    });
    try {
      await candidate.connect();
      const db = candidate.db(env.mongodbDb);
      await db.command({ ping: 1 });
      await ensureIndexes(db);
      client = candidate;
      database = db;
      return db;
    } catch (error) {
      await candidate.close();
      // Do not log raw driver errors: connection details may contain credentials.
      const reason = error.code === 11000 ? 'Existing duplicate records prevent unique index creation.' : 'Check the connection string, database user permissions, Atlas network access, and existing indexes.';
      throw new Error('MongoDB initialization failed. ' + reason);
    } finally { connecting = undefined; }
  })();
  return connecting;
}

export function getMongoClient() {
  if (!client) throw new Error('Database has not been initialized.');
  return client;
}

export function getDatabase() {
  if (!database) throw new Error('Database has not been initialized.');
  return database;
}

export function getCollections() {
  const db = getDatabase();
  return Object.fromEntries(Object.entries(collectionNames).map(([key, name]) => [key, db.collection(name)]));
}

export async function pingDatabase() {
  if (!database) return false;
  try { await database.command({ ping: 1 }, { timeoutMS: 3000 }); return true; }
  catch { return false; }
}

export async function closeDatabase() {
  if (connecting) await connecting.catch(() => {});
  const closing = client;
  database = undefined;
  client = undefined;
  if (closing) await closing.close();
}

