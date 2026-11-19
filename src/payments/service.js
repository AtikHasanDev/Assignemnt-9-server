import Stripe from 'stripe';
import { ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { getMongoClient } from '../db/mongodb.js';

const fail = (message, status = 409) => Object.assign(new Error(message), { status });
export function cents(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0.5 || amount > 100000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw fail('The final amount must be valid USD between $0.50 and $100,000.');
  return Math.round(amount * 100);
}
function bookingId(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw fail('Booking not found.', 404);
  return new ObjectId(value);
}
function sessionId(value) {
  if (typeof value !== 'string' || !/^cs_test_[A-Za-z0-9_]+$/.test(value) || value.length > 255) throw fail('Invalid checkout session.', 400);
  return value;
}
export function createPaymentService(db, {
  stripe = env.stripeSecret.startsWith('sk_test_') ? new Stripe(env.stripeSecret, { maxNetworkRetries: 2, timeout: 20000 }) : null,
  origin = env.paymentOrigin,
  webhookSecret = env.stripeWebhookSecret,
  transact = work => getMongoClient().withSession(session => session.withTransaction(() => work(session))),
} = {}) {
  const bookings = db.collection('bookings');
  const payments = db.collection('payments');
  const ready = () => { if (!stripe) throw fail('Stripe test payments are not configured yet.', 503); };
  const retrieve = async id => {
    ready();
    try { return await stripe.checkout.sessions.retrieve(sessionId(id)); }
    catch (error) { if (error.status) throw error; throw fail('Checkout could not be verified. Please try again.', 502); }
  };
  async function fulfill(id, customerEmail) {
    const checkout = await retrieve(id);
    if (checkout.livemode !== false || checkout.mode !== 'payment') throw fail('This is not a test repair payment.');
    const filter = { _id: bookingId(checkout.metadata?.bookingId) };
    const booking = await bookings.findOne(filter);
    if (!booking || (customerEmail && booking.customerEmail !== customerEmail)) throw fail('Payment not found.', 404);
    if (checkout.client_reference_id !== String(booking._id) || checkout.customer_email !== booking.customerEmail || checkout.currency !== 'usd' || checkout.amount_total !== cents(booking.finalAmount) || checkout.metadata?.checkoutKey !== booking.checkoutKey || checkout.id !== booking.stripeSessionId) throw fail('Checkout does not match this booking.');
    if (checkout.payment_status !== 'paid') return { paid: false, bookingId: String(booking._id) };
    if (typeof checkout.payment_intent !== 'string' || !checkout.payment_intent.startsWith('pi_')) throw fail('Checkout has no valid payment transaction.');
    const record = {
      bookingId: String(booking._id), stripeSessionId: checkout.id, transactionId: checkout.payment_intent,
      customerEmail: booking.customerEmail, technicianEmail: booking.technicianEmail,
      serviceTitle: booking.serviceTitle, amount: checkout.amount_total / 100, currency: 'usd', paidAt: new Date(),
    };
    // Booking state and payment history commit together. Unique indexes and
    // transaction retries make webhook/return-page races idempotent.
    try {
      await transact(async session => {
        const current = await bookings.findOne(filter, { session });
        if (!current || current.status !== 'completed' || current.stripeSessionId !== checkout.id || current.checkoutKey !== checkout.metadata.checkoutKey || cents(current.finalAmount) !== checkout.amount_total) throw fail('Booking is not eligible for this payment.');
        const existing = await payments.findOne({ bookingId: record.bookingId }, { session });
        if (existing) {
          if (existing.stripeSessionId !== checkout.id || existing.transactionId !== record.transactionId) throw fail('A different payment already exists for this booking.');
          return;
        }
        if (current.paymentStatus !== 'unpaid') throw fail('Booking payment state requires review.');
        await payments.insertOne(record, { session });
        const now = record.paidAt;
        const result = await bookings.updateOne({ ...filter, status: 'completed', paymentStatus: 'unpaid', stripeSessionId: checkout.id }, { $set: { paymentStatus: 'paid', paidAt: now, updatedAt: now }, $push: { statusHistory: { status: 'paid', changedAt: now } } }, { session });
        if (!result.matchedCount) throw fail('Booking changed during payment verification.');
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await payments.findOne({ bookingId: record.bookingId });
      if (!existing || existing.stripeSessionId !== checkout.id || existing.transactionId !== record.transactionId) throw fail('A different payment already exists for this booking.');
    }
    return { paid: true, bookingId: record.bookingId, transactionId: record.transactionId, amount: record.amount };
  }
  async function checkout(id, customerEmail) {
    ready();
    if (!env.clientOrigins.includes(origin) || new URL(origin).origin !== origin) throw fail('Payment return URL is not configured.', 503);
    const filter = { _id: bookingId(id), customerEmail };
    let booking = await bookings.findOne(filter);
    if (!booking) throw fail('Booking not found.', 404);
    if (booking.status !== 'completed' || booking.paymentStatus !== 'unpaid') throw fail('Only completed, unpaid repairs can be paid.');
    const amount = cents(booking.finalAmount);
    if (booking.stripeSessionId) {
      const previous = await retrieve(booking.stripeSessionId);
      if (previous.payment_status === 'paid') { await fulfill(previous.id, customerEmail); throw fail('This repair is already paid. Refresh your bookings.'); }
      if (previous.status === 'open') return checkoutResult(previous);
      if (previous.status !== 'expired') throw fail('This payment is still processing. Please wait before trying again.');
      await bookings.updateOne({ ...filter, stripeSessionId: previous.id, paymentStatus: 'unpaid' }, { $unset: { checkoutKey: '', stripeSessionId: '' } });
      booking = await bookings.findOne(filter);
    }
    if (!booking.checkoutKey) {
      await bookings.updateOne({ ...filter, status: 'completed', paymentStatus: 'unpaid', checkoutKey: { $exists: false } }, { $set: { checkoutKey: randomUUID() } });
      booking = await bookings.findOne(filter);
    }
    if (!booking?.checkoutKey || booking.paymentStatus !== 'unpaid') throw fail('Booking changed. Refresh and try again.');
    let created;
    try {
      created = await stripe.checkout.sessions.create({
        mode: 'payment', customer_email: booking.customerEmail,
        client_reference_id: String(booking._id), metadata: { bookingId: String(booking._id), checkoutKey: booking.checkoutKey },
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount, product_data: { name: 'Completed repair: ' + booking.serviceTitle } } }],
        success_url: origin + '/dashboard/customer/payment/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: origin + '/dashboard/customer/payment/cancel',
      }, { idempotencyKey: 'repair-' + booking.checkoutKey });
    } catch { throw fail('Checkout is temporarily unavailable. Please try again.', 502); }
    sessionId(created.id);
    const result = await bookings.updateOne({ ...filter, checkoutKey: booking.checkoutKey, paymentStatus: 'unpaid' }, { $set: { stripeSessionId: created.id } });
    if (!result.matchedCount) throw fail('Booking changed. Refresh and try again.');
    return checkoutResult(created);
  }
  function checkoutResult(value) {
    let url;
    try { url = new URL(value.url); } catch { throw fail('Checkout returned an invalid URL.', 502); }
    if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password) throw fail('Checkout returned an invalid URL.', 502);
    return { url: url.href };
  }
  function event(body, signature) {
    ready();
    if (!webhookSecret) throw fail('Stripe webhook is not configured.', 503);
    try { return stripe.webhooks.constructEvent(body, signature, webhookSecret); }
    catch { throw fail('Invalid webhook signature.', 400); }
  }
  return { checkout, fulfill, event };
}
