import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { connectDatabase, getDatabase, closeDatabase } from '../src/db/mongodb.js';
import { createPaymentService } from '../src/payments/service.js';

// Real MongoDB transactions with a simulated provider. No Stripe charge is made.
const id = new ObjectId();
let db;
try {
  await connectDatabase(); db = getDatabase();
  const booking = { _id: id, customerEmail: 'payment-check-' + id + '@example.invalid', technicianEmail: 'transaction-check@example.invalid', serviceTitle: 'Disposable transaction check', status: 'completed', paymentStatus: 'unpaid', finalAmount: 1, statusHistory: [] };
  await db.collection('bookings').insertOne(booking);
  const sessions = new Map();
  const stripe = { checkout: { sessions: {
    create: async params => {
      const session = { id: 'cs_test_transaction' + id, livemode: false, mode: 'payment', status: 'open', payment_status: 'unpaid', currency: 'usd', amount_total: params.line_items[0].price_data.unit_amount, metadata: params.metadata, client_reference_id: params.client_reference_id, customer_email: params.customer_email, payment_intent: 'pi_transaction' + id, url: 'https://checkout.stripe.com/c/pay/transaction-check' };
      sessions.set(session.id, session); return session;
    },
    retrieve: async sessionId => sessions.get(sessionId),
  } } };
  const service = createPaymentService(db, { stripe, origin: 'http://localhost:3000' });
  await service.checkout(String(id), booking.customerEmail);
  const session = [...sessions.values()][0]; session.payment_status = 'paid'; session.status = 'complete';
  const results = await Promise.all([service.fulfill(session.id), service.fulfill(session.id, booking.customerEmail), service.fulfill(session.id)]);
  assert.ok(results.every(result => result.paid));
  assert.equal(await db.collection('payments').countDocuments({ bookingId: String(id) }), 1);
  const saved = await db.collection('bookings').findOne({ _id: id });
  assert.equal(saved.paymentStatus, 'paid'); assert.equal(saved.statusHistory.filter(entry => entry.status === 'paid').length, 1);
  console.log('PASS: real MongoDB concurrent fulfillment commits one payment and one paid timeline event. Stripe was simulated.');
} catch {
  console.error('Payment transaction integration check failed. Check database access and transaction support.'); process.exitCode = 1;
} finally {
  if (db) {
    await db.collection('payments').deleteMany({ bookingId: String(id) });
    await db.collection('bookings').deleteOne({ _id: id });
    console.log('Disposable transaction-check records removed.');
  }
  await closeDatabase();
}
