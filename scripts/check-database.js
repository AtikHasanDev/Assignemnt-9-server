import { closeDatabase, connectDatabase, pingDatabase } from '../src/db/mongodb.js';
import { collectionNames } from '../src/db/indexes.js';

try {
  const db = await connectDatabase();
  if (!await pingDatabase()) throw new Error('Database ping failed.');
  console.log('MongoDB connected. Application indexes initialized.');
  for (const name of Object.values(collectionNames)) {
    const indexes = await db.collection(name).listIndexes().toArray();
    console.log(name + ': ' + indexes.map(index => index.name).join(', '));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await closeDatabase(); }

