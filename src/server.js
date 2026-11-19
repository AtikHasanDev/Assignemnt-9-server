import { createApp } from './app.js';
import { createAuth } from './auth/auth.js';
import { createAuthorization } from './middleware/auth.js';
import { getDatabase } from './db/mongodb.js';
import { ObjectId } from 'mongodb';
import { env } from './config/env.js';
import { closeDatabase, connectDatabase, pingDatabase } from './db/mongodb.js';

let server;
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(signal + ': closing API and database connections.');
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  if (server) await new Promise(resolve => server.close(resolve));
  await closeDatabase();
  clearTimeout(timeout);
}

try {
  await connectDatabase();
  server = createApp({ db: getDatabase(), checkDatabase: pingDatabase, auth: createAuth(), authorization: createAuthorization({
    secret: env.jwtSecret,
    findUser: id => getDatabase().collection('user').findOne({ _id: new ObjectId(id) }),
  }) }).listen(env.port, () => {
    console.log('FixMate API ready at http://localhost:' + env.port);
  });
  server.on('error', async () => {
    console.error('Unable to start the HTTP server. Check PORT and whether it is already in use.');
    process.exitCode = 1;
    await shutdown('Startup error');
  });
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
} catch (error) {
  console.error(error.message);
  await closeDatabase();
  process.exitCode = 1;
}

