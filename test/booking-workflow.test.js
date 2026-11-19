import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { technicianTransition } from '../src/bookings/workflow.js';
import { createApp } from '../src/app.js';
import { createAuthorization } from '../src/middleware/auth.js';

test('technician pipeline permits only exact forward transitions', () => {
  const allowed = { requested: ['accepted', 'rejected'], accepted: ['in-progress'], 'in-progress': ['completed'] };
  const statuses = ['requested', 'accepted', 'in-progress', 'completed', 'rejected', 'cancelled'];
  for (const current of statuses) for (const next of statuses) {
    if (allowed[current]?.includes(next)) assert.equal(technicianTransition(current, next, 25).status, next);
    else assert.throws(() => technicianTransition(current, next, 25));
  }
  assert.throws(() => technicianTransition('completed', 'paid', 25), { status: 400 });
});
test('completion requires a valid final amount and other transitions cannot alter it', () => {
  for (const amount of [undefined, null, '25', 0, -1, NaN, Infinity, 25.555, 100001]) assert.throws(() => technicianTransition('in-progress', 'completed', amount), { status: 400 });
  assert.deepEqual(technicianTransition('in-progress', 'completed', 25.5), { status: 'completed', finalAmount: 25.5 });
  assert.deepEqual(technicianTransition('requested', 'accepted', 1), { status: 'accepted' });
});

test('booking actions enforce ownership, cancellation gate, atomic transitions, and history', async () => {
  const customer = { _id: new ObjectId(), email: 'customer@example.com', role: 'customer' };
  const technician = { _id: new ObjectId(), email: 'tech@example.com', role: 'technician' };
  const stranger = { _id: new ObjectId(), email: 'stranger@example.com', role: 'technician' };
  const users = [customer, technician, stranger];
  const authorization = createAuthorization({ secret: 'workflow-test-signing-secret-at-least-32-characters', findUser: async id => users.find(user => String(user._id) === id) });
  const bookingId = new ObjectId();
  let record = { _id: bookingId, customerEmail: customer.email, technicianEmail: technician.email, status: 'requested', basePrice: 40, finalAmount: 40, paymentStatus: 'unpaid', statusHistory: [] };
  let listFilter;
  const matches = filter => String(filter._id) === String(record._id) && (!filter.customerEmail || filter.customerEmail === record.customerEmail) && (!filter.technicianEmail || filter.technicianEmail === record.technicianEmail) && (!filter.status || filter.status === record.status);
  const bookings = {
    findOne: async filter => matches(filter) ? { ...record } : null,
    updateOne: async (filter, update) => {
      if (!matches(filter)) return { matchedCount: 0 };
      Object.assign(record, update.$set); record.statusHistory.push(update.$push.statusHistory);
      return { matchedCount: 1 };
    },
    find: filter => { listFilter = filter; return { sort: () => ({ toArray: async () => [] }) }; },
  };
  const server = createApp({ db: { collection: () => bookings }, authorization }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/bookings';
  const tokens = await Promise.all(users.map(user => authorization.issueToken(user)));
  const patch = (action, body, index = 1) => fetch(base + '/' + bookingId + '/' + action, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens[index] }, body: JSON.stringify(body) });
  try {
    assert.equal((await patch('status', { status: 'accepted' }, 0)).status, 403);
    assert.equal((await patch('status', { status: 'accepted' }, 2)).status, 404);
    assert.equal((await patch('cancel', {}, 1)).status, 403);
    assert.equal((await patch('status', { status: 'completed', finalAmount: 20 })).status, 409);
    const results = await Promise.all([patch('status', { status: 'accepted' }), patch('cancel', {}, 0)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    // Whichever branch won, reset this isolated in-memory fixture to test the
    // remaining pipeline. No real database records are touched.
    record.status = 'accepted'; record.statusHistory = [];
    assert.equal((await patch('cancel', {}, 0)).status, 409);
    assert.equal((await patch('status', { status: 'rejected' })).status, 409);
    assert.equal((await patch('status', { status: 'in-progress', finalAmount: 1 })).status, 200);
    assert.equal(record.finalAmount, 40);
    assert.equal((await patch('status', { status: 'completed' })).status, 400);
    assert.equal((await patch('status', { status: 'completed', finalAmount: 65.5, paymentStatus: 'paid' })).status, 200);
    assert.equal(record.finalAmount, 65.5); assert.equal(record.paymentStatus, 'unpaid');
    assert.deepEqual(record.statusHistory.map(event => event.status), ['in-progress', 'completed']);
    assert.equal((await patch('status', { status: 'in-progress' })).status, 409);
    record.status = 'requested'; assert.equal((await patch('cancel', {}, 0)).status, 200); assert.equal(record.status, 'cancelled');
    assert.equal((await patch('cancel', {}, 0)).status, 409);
    const queue = await fetch(base + '/technician?status=requested&email=another@example.com', { headers: { Authorization: 'Bearer ' + tokens[1] } });
    assert.equal(queue.status, 200); assert.deepEqual(listFilter, { technicianEmail: technician.email, status: 'requested' });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
