import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { createApp } from '../src/app.js';
import { createAuthorization } from '../src/middleware/auth.js';

test('overview endpoints restrict roles and scope customer/technician queries to current users', async () => {
  const users = ['customer', 'technician', 'admin'].map(role => ({ _id: new ObjectId(), role, email: role + '@example.com' }));
  const authorization = createAuthorization({ secret: 'dashboard-test-secret-at-least-thirty-two-characters', findUser: async id => users.find(user => String(user._id) === id) });
  const calls = [];
  const db = { collection: name => ({
    aggregate: pipeline => {
      calls.push({ name, pipeline });
      const rows = name === 'bookings' ? [ { _id: 'requested', count: 2 }, { _id: 'accepted', count: 1 }, { _id: 'in-progress', count: 3 }, { _id: 'completed', count: 4 }, { _id: 'rejected', count: 1 }, { _id: 'cancelled', count: 2 } ] : [ { _id: 'pending', count: 7 }, { _id: 'approved', count: 8 }, { _id: 'rejected', count: 1 } ];
      return { toArray: async () => rows };
    },
    countDocuments: async filter => {
      calls.push({ name, filter });
      if (name === 'user') return filter.role === 'technician' ? 6 : 15;
      if (name === 'bookings') return 2;
      if (filter.approvalStatus === 'pending') return 7;
      return filter.approvalStatus === 'approved' ? 5 : 9;
    },
  }) };
  const server = createApp({ db, authorization }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/dashboard/';
  const tokens = await Promise.all(users.map(user => authorization.issueToken(user)));
  const request = (role, token) => fetch(base + role + '?email=attacker@example.com', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  try {
    assert.equal((await request('customer')).status, 401);
    for (let i = 0; i < users.length; i++) for (const user of users) {
      if (users[i].role !== user.role) assert.equal((await request(user.role, tokens[i])).status, 403);
    }
    calls.length = 0;
    const customer = await request('customer', tokens[0]);
    assert.equal(customer.status, 200); assert.equal(customer.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await customer.json()).stats.map(stat => stat.value), [13, 6, 4]);
    assert.deepEqual(calls[0].pipeline[0].$match, { customerEmail: users[0].email });
    calls.length = 0;
    const technician = await request('technician', tokens[1]);
    assert.deepEqual((await technician.json()).stats.map(stat => stat.value), [9, 5, 2]);
    for (const call of calls) assert.equal((call.filter || call.pipeline[0].$match).technicianEmail, users[1].email);
    const admin = await request('admin', tokens[2]);
    const data = await admin.json();
    assert.deepEqual(data.stats.map(stat => stat.value), [15, 6, 7]);
    assert.deepEqual(data.chart.items.map(item => item.value), [7, 8, 1]);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('empty customer overview reports real zero values and all chart stages', async () => {
  const user = { _id: new ObjectId(), role: 'customer', email: 'empty@example.com' };
  const authorization = createAuthorization({ secret: 'empty-dashboard-test-secret-at-least-thirty-two', findUser: async () => user });
  const db = { collection: () => ({ aggregate: () => ({ toArray: async () => [] }) }) };
  const server = createApp({ db, authorization }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const token = await authorization.issueToken(user);
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/dashboard/customer', { headers: { Authorization: 'Bearer ' + token } });
    const data = await response.json();
    assert.deepEqual(data.stats.map(stat => stat.value), [0, 0, 0]);
    assert.equal(data.chart.items.length, 6);
    assert.ok(data.chart.items.every(item => item.value === 0));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
