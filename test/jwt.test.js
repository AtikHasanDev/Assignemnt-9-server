import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { ObjectId } from 'mongodb';
import { SignJWT } from 'jose';
import { createAuthorization } from '../src/middleware/auth.js';

const secret = 'test-only-jwt-secret-at-least-thirty-two-characters';
test('JWT middleware enforces signature, expiration, live role, and account existence', async () => {
  const id = new ObjectId();
  let currentUser = { _id: id, email: 'jwt-test@example.com', role: 'customer' };
  const auth = createAuthorization({ secret, findUser: async () => currentUser });
  const app = express();
  app.get('/customer', auth.verifyToken, auth.verifyCustomer, (_req, res) => res.sendStatus(204));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/customer';
  const request = token => fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  try {
    const token = await auth.issueToken(currentUser);
    assert.equal((await request()).status, 401);
    assert.equal((await request('invalid')).status, 401);
    assert.equal((await request(token)).status, 204);
    currentUser = { ...currentUser, role: 'technician' };
    assert.equal((await request(token)).status, 403);
    currentUser = null;
    assert.equal((await request(token)).status, 401);
    const expired = await new SignJWT({ email: 'jwt-test@example.com' }).setProtectedHeader({ alg: 'HS256' }).setSubject(String(id)).setIssuer('fixmate-api').setAudience('fixmate-client').setExpirationTime(1).sign(new TextEncoder().encode(secret));
    assert.equal((await request(expired)).status, 401);
    const foreign = createAuthorization({ secret: 'another-completely-independent-signing-key', findUser: async () => currentUser });
    assert.equal((await request(await foreign.issueToken({ _id: id, email: 'jwt-test@example.com' }))).status, 401);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
