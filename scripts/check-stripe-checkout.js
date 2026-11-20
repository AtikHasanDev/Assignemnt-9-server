import 'dotenv/config';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { ObjectId } from 'mongodb';
import { connectDatabase, getDatabase, closeDatabase } from '../src/db/mongodb.js';
import { createPaymentService } from '../src/payments/service.js';

if (!process.env.STRIPE_SECRET_KEY?.trim().startsWith('sk_test_')) throw new Error('Configure a Stripe test key first.');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY.trim());
const createSession = stripe.checkout.sessions.create.bind(stripe.checkout.sessions);
stripe.checkout.sessions.create = async (...args) => {
  try { return await createSession(...args); }
  catch (error) {
    console.error('Stripe setup response: ' + String(error.message || error.type).replace(/(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+/g, '[REDACTED]'));
    throw error;
  }
};
const id = new ObjectId();
let db, sessionId;
try {
  await connectDatabase(); db = getDatabase();
  await db.collection('bookings').insertOne({ _id: id, customerEmail: 'checkout-check@example.invalid', technicianEmail: 'setup-check@example.invalid', serviceTitle: 'Disposable Stripe checkout verification', status: 'completed', paymentStatus: 'unpaid', finalAmount: 1, statusHistory: [] });
  const service = createPaymentService(db, { stripe });
  const checkout = await service.checkout(String(id), 'checkout-check@example.invalid');
  const booking = await db.collection('bookings').findOne({ _id: id }); sessionId = booking.stripeSessionId;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  assert.equal(session.livemode, false); assert.equal(session.amount_total, 100); assert.equal(session.payment_status, 'unpaid');
  assert.equal(session.adaptive_pricing?.enabled, false);
  assert.equal(new URL(checkout.url).origin, 'https://checkout.stripe.com');
  assert.equal((await service.fulfill(sessionId, 'checkout-check@example.invalid')).paid, false);
  console.log('PASS: Stripe accepted the saved test key, created a real $1 test Checkout session, and verification correctly reported unpaid. No payment submitted.');
} catch (error) {
  console.error('Stripe checkout setup check failed (' + (error.type || error.status || 'connection/configuration') + ').'); process.exitCode = 1;
} finally {
  if (sessionId) { await stripe.checkout.sessions.expire(sessionId); console.log('Disposable Stripe checkout session expired.'); }
  if (db) { await db.collection('bookings').deleteOne({ _id: id }); console.log('Disposable MongoDB booking removed.'); }
  await closeDatabase();
}
