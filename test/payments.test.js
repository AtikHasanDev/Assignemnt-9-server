import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import Stripe from 'stripe';
import { createPaymentService, cents } from '../src/payments/service.js';
import { createApp } from '../src/app.js';
import { createAuthorization } from '../src/middleware/auth.js';

function fixture() {
  const booking = { _id: new ObjectId(), customerEmail: 'payer@example.com', technicianEmail: 'tech@example.com', serviceTitle: 'Screen repair', status: 'completed', paymentStatus: 'unpaid', finalAmount: 25.75, statusHistory: [] };
  const records = [];
  const sessions = new Map();
  const calls = [];
  const matches = (object, filter) => Object.entries(filter).every(([key, value]) => typeof value === 'object' && value !== null && '$exists' in value ? Object.hasOwn(object, key) === value.$exists : String(object[key]) === String(value));
  let failUpdate = false;
  const db = { collection: name => name === 'bookings' ? {
    findOne: async filter => matches(booking, filter) ? { ...booking } : null,
    updateOne: async (filter, update) => {
      if (!matches(booking, filter) || (failUpdate && update.$set?.paymentStatus === 'paid')) return { matchedCount: 0 };
      Object.assign(booking, update.$set);
      for (const key of Object.keys(update.$unset || {})) delete booking[key];
      if (update.$push?.statusHistory) booking.statusHistory.push(update.$push.statusHistory);
      return { matchedCount: 1 };
    },
  } : {
    findOne: async filter => records.find(record => matches(record, filter)),
    insertOne: async record => { records.push(record); },
  } };
  const sdk = new Stripe('sk_test_fixture');
  const stripe = { webhooks: sdk.webhooks, checkout: { sessions: {
    create: async (params, options) => {
      calls.push({ params, options });
      const previous = [...sessions.values()].find(session => session.metadata.checkoutKey === params.metadata.checkoutKey);
      if (previous) return previous;
      const session = { id: 'cs_test_fixture' + sessions.size, livemode: false, mode: 'payment', currency: 'usd', payment_status: 'unpaid', status: 'open', url: 'https://checkout.stripe.com/c/pay/test', customer_email: params.customer_email, client_reference_id: params.client_reference_id, metadata: params.metadata, amount_total: params.line_items[0].price_data.unit_amount, payment_intent: 'pi_fixture' + sessions.size };
      sessions.set(session.id, session); return session;
    },
    retrieve: async id => { if (!sessions.has(id)) throw new Error('not found'); return sessions.get(id); },
  } } };
  let queue = Promise.resolve();
  const transact = work => {
    const result = queue.then(async () => {
      const before = { ...booking, statusHistory: [...booking.statusHistory] }; const count = records.length;
      try { return await work({}); }
      catch (error) { Object.assign(booking, before); records.length = count; throw error; }
    });
    queue = result.catch(() => {}); return result;
  };
  const service = createPaymentService(db, { stripe, origin: 'http://localhost:3000', webhookSecret: 'whsec_fixture', transact });
  return { booking, records, sessions, calls, db, stripe, service, sdk, failUpdates: () => { failUpdate = true; } };
}

test('checkout enforces ownership, completion, unpaid state, trusted amounts, and session reuse', async () => {
  const f = fixture(); const id = String(f.booking._id);
  await assert.rejects(f.service.checkout(id, 'other@example.com'), { status: 404 });
  for (const status of ['requested', 'accepted', 'in-progress', 'cancelled', 'rejected']) { f.booking.status = status; await assert.rejects(f.service.checkout(id, f.booking.customerEmail), { status: 409 }); }
  f.booking.status = 'completed'; f.booking.paymentStatus = 'paid'; await assert.rejects(f.service.checkout(id, f.booking.customerEmail), { status: 409 }); f.booking.paymentStatus = 'unpaid';
  const [a, b] = await Promise.all([f.service.checkout(id, f.booking.customerEmail), f.service.checkout(id, f.booking.customerEmail)]);
  assert.equal(a.url, b.url); assert.equal(f.sessions.size, 1);
  for (const call of f.calls) {
    assert.equal(call.params.line_items[0].price_data.unit_amount, 2575);
    assert.equal(call.params.customer_email, f.booking.customerEmail);
    assert.equal(call.params.metadata.bookingId, id); assert.equal(call.params.payment_method_types, undefined);
    assert.equal(call.options.idempotencyKey, 'repair-' + f.booking.checkoutKey);
    assert.ok(call.params.success_url.startsWith('http://localhost:3000/dashboard/customer/payment/success'));
  }
  await f.service.checkout(id, f.booking.customerEmail); assert.equal(f.sessions.size, 1);
  const expired = f.sessions.get(f.booking.stripeSessionId); expired.status = 'expired';
  await f.service.checkout(id, f.booking.customerEmail); assert.equal(f.sessions.size, 2); assert.notEqual(f.booking.stripeSessionId, expired.id);
  for (const amount of [NaN, Infinity, 0, -1, '25', 0.49, 1.234, 100001]) assert.throws(() => cents(amount));
  assert.equal(cents(0.5), 50);
  await assert.rejects(createPaymentService(f.db, { stripe: null }).checkout(id, f.booking.customerEmail), { status: 503 });
});

test('verified payments reject mismatches and commit exactly once across concurrent callbacks', async () => {
  const f = fixture(); await f.service.checkout(String(f.booking._id), f.booking.customerEmail);
  const session = f.sessions.get(f.booking.stripeSessionId);
  assert.equal((await f.service.fulfill(session.id, f.booking.customerEmail)).paid, false); assert.equal(f.records.length, 0);
  session.payment_status = 'paid'; session.status = 'complete';
  await assert.rejects(f.service.fulfill(session.id, 'other@example.com'), { status: 404 });
  for (const [key, value] of [['amount_total', 1], ['currency', 'eur'], ['livemode', true], ['mode', 'subscription'], ['customer_email', 'wrong@example.com'], ['client_reference_id', 'wrong'], ['payment_intent', null]]) {
    const original = session[key]; session[key] = value; await assert.rejects(f.service.fulfill(session.id)); session[key] = original;
  }
  const key = session.metadata.checkoutKey; session.metadata = { ...session.metadata, checkoutKey: 'wrong' }; await assert.rejects(f.service.fulfill(session.id)); session.metadata.checkoutKey = key;
  const results = await Promise.all([f.service.fulfill(session.id), f.service.fulfill(session.id, f.booking.customerEmail), f.service.fulfill(session.id)]);
  assert.ok(results.every(result => result.paid)); assert.equal(f.records.length, 1); assert.equal(f.booking.paymentStatus, 'paid'); assert.equal(f.booking.statusHistory.filter(entry => entry.status === 'paid').length, 1);
  assert.equal(f.records[0].amount, 25.75); assert.equal(f.records[0].transactionId, session.payment_intent);
  await assert.rejects(f.service.checkout(String(f.booking._id), f.booking.customerEmail), { status: 409 });
});

test('failed booking update rolls back payment history', async () => {
  const f = fixture(); await f.service.checkout(String(f.booking._id), f.booking.customerEmail);
  const session = f.sessions.get(f.booking.stripeSessionId); session.payment_status = 'paid'; f.failUpdates();
  await assert.rejects(f.service.fulfill(session.id)); assert.equal(f.records.length, 0); assert.equal(f.booking.paymentStatus, 'unpaid'); assert.equal(f.booking.statusHistory.length, 0);
});

test('payment routes require customer authorization and webhooks verify the raw signed body', async () => {
  const f = fixture();
  const user = { _id: new ObjectId(), email: f.booking.customerEmail, role: 'customer' };
  const authorization = createAuthorization({ secret: 'payment-test-secret-at-least-32-characters', findUser: async () => user });
  const token = await authorization.issueToken(user);
  const server = createApp({ db: f.db, authorization, payments: f.service }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/payments';
  const post = (path, body, auth = true) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/checkout', { bookingId: String(f.booking._id) }, false)).status, 401);
    for (const role of ['technician', 'admin']) { user.role = role; assert.equal((await post('/checkout', { bookingId: String(f.booking._id) })).status, 403); }
    user.role = 'customer';
    assert.equal((await post('/checkout', { bookingId: String(f.booking._id), amount: 1, customerEmail: 'attacker@example.com', successUrl: 'https://evil.example' })).status, 200);
    assert.equal(f.calls[0].params.line_items[0].price_data.unit_amount, 2575);
    assert.equal((await post('/verify', { sessionId: 'cs_live_fake' })).status, 400);
    const session = f.sessions.get(f.booking.stripeSessionId); session.payment_status = 'paid'; session.status = 'complete';
    const payload = JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed', data: { object: { id: session.id } } });
    const signature = f.sdk.webhooks.generateTestHeaderString({ payload, secret: 'whsec_fixture' });
    const deliver = (body, header) => fetch(base + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body });
    assert.equal((await deliver(payload, 'invalid')).status, 400);
    assert.equal((await deliver(payload + ' ', signature)).status, 400);
    assert.equal(f.records.length, 0);
    assert.equal((await deliver(payload, signature)).status, 200);
    assert.equal((await deliver(payload, signature)).status, 200);
    const verified = await post('/verify', { sessionId: session.id }); assert.equal(verified.status, 200); assert.equal((await verified.json()).paid, true);
    assert.equal(f.records.length, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
