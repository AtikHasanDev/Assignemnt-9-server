import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('token exchange requires both a trusted origin and a server-verified session', async () => {
  let session = null;
  let issued = 0;
  const auth = { api: { getSession: async () => session } };
  const authorization = { issueToken: async () => { issued++; return 'test-token'; }, verifyToken: (_req, _res, next) => next() };
  const server = createApp({ auth, authorization }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/api/token';
  const send = origin => fetch(url, { method: 'POST', headers: origin ? { Origin: origin } : {} });
  try {
    assert.equal((await send()).status, 403);
    assert.equal((await send('http://localhost:3000')).status, 401);
    assert.equal(issued, 0);
    session = { user: { id: 'test-id', email: 'test@example.com' } };
    const response = await send('http://localhost:3000');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).expiresIn, 900);
    assert.equal(issued, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
