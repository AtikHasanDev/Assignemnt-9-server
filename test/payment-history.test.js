import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { createApp } from '../src/app.js';
import { createAuthorization } from '../src/middleware/auth.js';

test('payment history scopes customers and restricts the administrator transaction list', async () => {
  const user = { _id: new ObjectId(), email: 'owner@example.com', role: 'customer' };
  const authorization = createAuthorization({ secret: 'history-test-signing-secret-at-least-32-characters', findUser: async () => user });
  const records = Array.from({ length: 15 }, (_, index) => ({ _id: String(index), customerEmail: index < 13 ? user.email : 'other@example.com', technicianEmail: 'tech@example.com', serviceTitle: 'Repair ' + index, bookingId: String(new ObjectId()), transactionId: 'pi_' + index, amount: 12.5, currency: 'usd', paidAt: new Date(), stripeSessionId: 'private-session' }));
  let seen;
  const match = (record, filter) => Object.entries(filter).every(([key, value]) => record[key] === value);
  const db = { collection: name => ({
    find(filter, { projection }) {
      assert.equal(name, 'payments'); seen = { filter, projection };
      let offset = 0, limit = 0;
      const cursor = {
        sort(value) { assert.deepEqual(value, { paidAt: -1, _id: -1 }); return cursor; },
        skip(value) { offset = value; return cursor; }, limit(value) { limit = value; return cursor; },
        toArray: async () => records.filter(record => match(record, filter)).slice(offset, offset + limit).map(record => Object.fromEntries(Object.entries(record).filter(([key]) => key === '_id' || projection[key] === 1))),
      }; return cursor;
    },
    countDocuments: async filter => records.filter(record => match(record, filter)).length,
    aggregate: pipeline => ({ toArray: async () => [{ amount: records.filter(record => match(record, pipeline[0].$match)).reduce((sum, record) => sum + record.amount, 0) }] }),
  }) };
  const server = createApp({ db, authorization }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let token = await authorization.issueToken(user);
  const get = (path, auth = true) => fetch(base + path, { headers: auth ? { Authorization: 'Bearer ' + token } : {} });
  try {
    for (const path of ['/api/payments/my', '/api/admin/transactions']) assert.equal((await get(path, false)).status, 401);
    const response = await get('/api/payments/my?page=2&limit=12');
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json(); assert.equal(data.total, 13); assert.equal(data.totalPages, 2); assert.equal(data.items.length, 1);
    assert.equal(data.totalRevenue, 162.5);
    assert.deepEqual(seen.filter, { customerEmail: user.email }); assert.equal(seen.projection.transactionId, 1); assert.equal(seen.projection.stripeSessionId, undefined);
    assert.ok(data.items.every(record => record.customerEmail === user.email)); assert.equal(data.items[0].stripeSessionId, undefined);
    assert.equal((await get('/api/admin/transactions')).status, 403);
    user.role = 'technician'; assert.equal((await get('/api/payments/my')).status, 403); assert.equal((await get('/api/admin/transactions')).status, 403);
    user.role = 'admin'; assert.equal((await get('/api/payments/my')).status, 403);
    const allResponse = await get('/api/admin/transactions'); assert.equal(allResponse.status, 200); assert.equal(allResponse.headers.get('cache-control'), 'no-store');
    const all = await allResponse.json(); assert.equal(all.total, 15); assert.equal(all.items.length, 12); assert.deepEqual(seen.filter, {});
    assert.equal(all.totalRevenue, 187.5);
    for (const role of ['admin', 'customer']) {
      user.role = role; const path = role === 'admin' ? '/api/admin/transactions' : '/api/payments/my';
      for (const query of ['?customerEmail=other@example.com', '?page=0', '?page=1e2', '?page=1&page=2', '?limit=101', '?limit=-1', '?page[$ne]=1']) assert.equal((await get(path + query)).status, 400, query);
      const empty = await (await get(path + '?page=100')).json(); assert.deepEqual(empty.items, []);
    }
    user.email = 'empty@example.com'; token = await authorization.issueToken(user);
    const emptyResponse = await get('/api/payments/my'); assert.equal(emptyResponse.status, 200);
    const empty = await emptyResponse.json(); assert.equal(empty.total, 0); assert.equal(empty.totalPages, 0); assert.deepEqual(empty.items, []);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
