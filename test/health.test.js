import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

async function withServer(checkDatabase, fn) {
  const server = createApp({ checkDatabase }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await fn('http://127.0.0.1:' + server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('database outage fails readiness but leaves liveness available', async () => {
  await withServer(async () => false, async base => {
    assert.equal((await fetch(base + '/api/health')).status, 200);
    const response = await fetch(base + '/api/ready');
    assert.equal(response.status, 503);
    assert.equal((await response.json()).database, 'unavailable');
  });
});

test('successful database ping makes the API ready', async () => {
  await withServer(async () => true, async base => {
    const response = await fetch(base + '/api/ready');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).database, 'connected');
  });
});

test('readiness failures never expose private connection details', async () => {
  await withServer(async () => { throw new Error('private-connection-string'); }, async base => {
    const response = await fetch(base + '/api/ready');
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('private-connection-string'), false);
  });
});

