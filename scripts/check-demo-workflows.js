import 'dotenv/config';
import { parse } from 'dotenv';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { ObjectId } from 'mongodb';
import { connectDatabase, getDatabase, closeDatabase } from '../src/db/mongodb.js';
import { env } from '../src/config/env.js';
import { dhakaDate } from '../src/bookings/validation.js';

const password = parse(readFileSync('.env.demo')).SEED_PASSWORD;
const base = env.authUrl, origin = env.clientOrigins[0];
const sessions = [];
const bookingIds = [];
let db, serviceId, checkoutId;
async function login(email, expectedRole) {
  // BetterAuth throttles sign-in separately from general API traffic.
  if (sessions.length) await new Promise(resolve => setTimeout(resolve, 4000));
  const signIn = () => fetch(base + '/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ email, password }) });
  let response = await signIn();
  if (response.status === 429) {
    const delay = Number(response.headers.get('retry-after')) || 11;
    await new Promise(resolve => setTimeout(resolve, Math.min(60000, Math.max(11000, delay * 1000))));
    response = await signIn();
  }
  assert.equal(response.status, 200, 'Demo sign-in failed for ' + expectedRole);
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const account = { cookie };
  sessions.push(account);
  const tokenResponse = await fetch(base + '/api/token', { method: 'POST', headers: { Origin: origin, Cookie: cookie } });
  assert.equal(tokenResponse.status, 200); account.token = (await tokenResponse.json()).token;
  const me = await fetch(base + '/api/me', { headers: { Authorization: 'Bearer ' + account.token } });
  assert.equal((await me.json()).role, expectedRole);
  return account;
}
async function request(account, path, method = 'GET', body, expected = 200) {
  const response = await fetch(base + path, { method, headers: { Origin: origin, Authorization: 'Bearer ' + account.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, expected, method + ' ' + path);
  return response.json();
}
try {
  await connectDatabase(); db = getDatabase();
  const admin = await login('admin.demo@fixmate.example', 'admin');
  const customer = await login('customer.demo@fixmate.example', 'customer');
  const technician = await login('nadia.demo@fixmate.example', 'technician');
  const otherTechnician = await login('rafi.demo@fixmate.example', 'technician');
  for (const [account, role] of [[admin, 'admin'], [customer, 'customer'], [technician, 'technician']]) await request(account, '/api/dashboard/' + role);
  await request(customer, '/api/admin/users', 'GET', undefined, 403);
  await request(technician, '/api/payments/my', 'GET', undefined, 403);
  console.log('PASS: all demo roles sign in and role boundaries hold.');
  const seeded = await db.collection('services').findOne({ demoSeed: 'fixmate-demo-v1', approvalStatus: 'approved' });
  const draft = { title: 'Disposable demo workflow service', description: 'Temporary workflow verification service, removed after this check.', category: 'Smartphone', image: seeded.image, basePrice: 1, estimatedDuration: '1 hour', serviceMode: 'Home Visit', serviceArea: 'Demo area, Dhaka' };
  const created = await request(technician, '/api/services', 'POST', draft, 201); serviceId = created._id;
  assert.equal(created.approvalStatus, 'pending');
  assert.equal((await fetch(base + '/api/services/' + serviceId)).status, 404);
  await request(admin, '/api/admin/services/' + serviceId + '/approval', 'PATCH', { approvalStatus: 'approved' });
  assert.equal((await fetch(base + '/api/services/' + serviceId)).status, 200);
  await request(technician, '/api/services/' + serviceId + '/availability', 'PATCH', { isAvailable: false });
  assert.equal((await fetch(base + '/api/services/' + serviceId)).status, 404);
  await request(technician, '/api/services/' + serviceId + '/availability', 'PATCH', { isAvailable: true });
  console.log('PASS: service creation, admin approval and availability control public visibility.');
  const payload = { serviceId, customerPhone: '+8801000000000', address: 'Disposable test address, Mirpur, Dhaka', problemDescription: 'Disposable repair request used for workflow verification only.', preferredDate: dhakaDate(new Date(Date.now() + 86400000)) };
  const first = await request(customer, '/api/bookings', 'POST', payload, 201); bookingIds.push(new ObjectId(first._id));
  assert.equal(Object.hasOwn(first, 'problemImage'), false);
  await request(customer, '/api/bookings', 'POST', payload, 409);
  await request(customer, '/api/bookings/' + first._id + '/cancel', 'PATCH');
  const second = await request(customer, '/api/bookings', 'POST', { ...payload, problemImage: seeded.image }, 201); bookingIds.push(new ObjectId(second._id));
  assert.equal(second.problemImage, seeded.image);
  const technicianQueue = await request(technician, '/api/bookings/technician');
  assert.equal(technicianQueue.items.find(item => item._id === second._id).problemImage, seeded.image);
  await request(otherTechnician, '/api/bookings/' + second._id + '/status', 'PATCH', { status: 'accepted' }, 404);
  await request(customer, '/api/bookings/' + second._id + '/status', 'PATCH', { status: 'accepted' }, 403);
  await request(technician, '/api/bookings/' + second._id + '/status', 'PATCH', { status: 'accepted' });
  await request(customer, '/api/bookings/' + second._id + '/cancel', 'PATCH', undefined, 409);
  await request(technician, '/api/bookings/' + second._id + '/status', 'PATCH', { status: 'in-progress' });
  await request(technician, '/api/bookings/' + second._id + '/status', 'PATCH', { status: 'completed', finalAmount: 1 });
  const saved = await db.collection('bookings').findOne({ _id: bookingIds[1] });
  assert.equal(saved.status, 'completed'); assert.equal(saved.statusHistory.length, 4);
  console.log('PASS: requests with/without damage photos, technician photo visibility, duplicate protection, cancellation, ownership and repair transitions.');
  if (env.stripeSecret.startsWith('sk_test_')) {
    const checkout = await request(customer, '/api/payments/checkout', 'POST', { bookingId: second._id, amount: 0.01 });
    assert.equal(new URL(checkout.url).origin, 'https://checkout.stripe.com');
    checkoutId = (await db.collection('bookings').findOne({ _id: bookingIds[1] })).stripeSessionId;
    const result = await request(customer, '/api/payments/verify', 'POST', { sessionId: checkoutId }); assert.equal(result.paid, false);
    console.log('PASS: real Stripe test checkout created with trusted amount and verified unpaid. No payment submitted.');
  }
  await request(customer, '/api/payments/my'); await request(admin, '/api/admin/transactions'); await request(admin, '/api/admin/bookings');
  await request(technician, '/api/services/' + serviceId, 'PATCH', draft);
  assert.equal((await fetch(base + '/api/services/' + serviceId)).status, 404);
  await request(technician, '/api/services/' + serviceId, 'DELETE');
  console.log('PASS: history/monitor APIs and edit approval reset; workflow checks complete.');
} catch (error) {
  console.error('Demo workflow check failed: ' + String(error.message).replace(/(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+/g, '[REDACTED]')); process.exitCode = 1;
} finally {
  if (checkoutId) { try { await new Stripe(env.stripeSecret).checkout.sessions.expire(checkoutId); } catch { console.error('Test checkout expiration needs review.'); process.exitCode = 1; } }
  if (db) {
    if (bookingIds.length) await db.collection('bookings').deleteMany({ _id: { $in: bookingIds } });
    if (serviceId) await db.collection('services').deleteOne({ _id: new ObjectId(serviceId) });
  }
  for (const account of sessions) await fetch(base + '/api/auth/sign-out', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: account.cookie }, body: '{}' }).catch(() => {});
  await closeDatabase(); console.log('Disposable workflow records removed; demo seed records preserved.');
}
