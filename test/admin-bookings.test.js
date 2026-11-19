import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { createApp } from '../src/app.js';
import { createAuthorization } from '../src/middleware/auth.js';

test('booking monitor restricts access and combines validated filters with stable pagination', async () => {
  const user = { _id: new ObjectId(), role: 'admin', email: 'monitor@example.com' };
  const authorization = createAuthorization({ secret: 'booking-monitor-test-secret-at-least-32-characters', findUser: async () => user });
  const records = Array.from({ length: 15 }, (_, i) => ({ _id: String(i), status: i < 13 ? 'completed' : 'requested', paymentStatus: i < 13 ? 'unpaid' : 'paid' }));
  let seen;
  const matches = (record, filter) => Object.entries(filter).every(([key, value]) => record[key] === value);
  const db = { collection: name => {
    return {
      find(filter, options) {
        assert.equal(name, 'bookings');
        seen = { filter, options };
        let skip = 0, limit = 0;
        const cursor = {
          sort(value) { assert.deepEqual(value, { createdAt: -1, _id: -1 }); return cursor; },
          skip(value) { skip = value; return cursor; }, limit(value) { limit = value; return cursor; },
          toArray: async () => records.filter(record => matches(record, filter)).slice(skip, skip + limit),
        };
        return cursor;
      },
      countDocuments: async filter => records.filter(record => matches(record, filter)).length,
    };
  } };
  const server = createApp({ db, authorization }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/admin/bookings';
  const token = await authorization.issueToken(user);
  const request = (query = '', authenticated = true) => fetch(base + query, { headers: authenticated ? { Authorization: 'Bearer ' + token } : {} });
  try {
    assert.equal((await request('', false)).status, 401);
    for (const role of ['customer', 'technician']) { user.role = role; assert.equal((await request()).status, 403); }
    user.role = 'admin';
    const response = await request('?status=completed&paymentStatus=unpaid&page=2&limit=12');
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    assert.equal(data.total, 13); assert.equal(data.totalPages, 2); assert.equal(data.page, 2); assert.equal(data.items.length, 1);
    assert.deepEqual(seen.filter, { status: 'completed', paymentStatus: 'unpaid' });
    assert.equal(seen.options.projection.statusHistory, 1); assert.equal(seen.options.projection.customerPhone, 1);
    const all = await (await request('?status=all&paymentStatus=all')).json(); assert.equal(all.total, 15);
    const empty = await (await request('?status=cancelled')).json(); assert.equal(empty.totalPages, 0); assert.deepEqual(empty.items, []);
    for (const query of ['?status=unknown', '?status=completed&status=requested', '?status[$ne]=completed', '?paymentStatus=refunded', '?paymentStatus=paid&paymentStatus=unpaid', '?page=0', '?limit=101', '?page=abc']) assert.equal((await request(query)).status, 400, query);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
