import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { createApp } from '../src/app.js';
import { createAuthorization } from '../src/middleware/auth.js';
import { validateBooking, dhakaDate } from '../src/bookings/validation.js';

const fields = { serviceId: 'abcdefabcdefabcdefabcdef', customerPhone: '+880 1712345678', address: 'Mirpur 10, Dhaka, Bangladesh', preferredDate: '2099-06-20', problemDescription: 'The laptop screen turns off after a few minutes.' };
test('damage photos are optional and accept only trusted image URLs when supplied', () => {
  assert.equal(Object.hasOwn(validateBooking(fields), 'problemImage'), false);
  assert.equal(Object.hasOwn(validateBooking({ ...fields, problemImage: '' }), 'problemImage'), false);
  assert.equal(validateBooking({ ...fields, problemImage: 'https://i.ibb.co/test/damage.png' }).problemImage, 'https://i.ibb.co/test/damage.png');
  for (const problemImage of [null, [], {}, 'not a URL', 'http://i.ibb.co/test/a.png', 'https://example.com/a.png', 'https://i.ibb.co.evil.example/a.png', 'https://user:secret@i.ibb.co/a.png', 'https://i.ibb.co:8443/a.png', 'https://i.ibb.co/' + 'a'.repeat(2048)]) assert.throws(() => validateBooking({ ...fields, problemImage }), { status: 400 });
});
test('booking dates use Bangladesh calendar boundaries and reject invalid inputs', () => {
  const now = new Date('2026-11-19T20:00:00Z');
  assert.equal(dhakaDate(now), '2026-11-20');
  assert.throws(() => validateBooking({ ...fields, preferredDate: '2026-11-19' }, now), { status: 400 });
  assert.doesNotThrow(() => validateBooking({ ...fields, preferredDate: '2026-11-20' }, now));
  for (const patch of [{ preferredDate: '2099-02-31' }, { preferredDate: 'invalid' }, { serviceId: 'bad' }, { customerPhone: 'abcdefgh' }, { problemDescription: 'short' }]) assert.throws(() => validateBooking({ ...fields, ...patch }, now), { status: 400 });
});

test('booking creation enforces roles, service visibility, trusted snapshots, and duplicate conflict handling', async () => {
  const user = { _id: new ObjectId(), name: 'Customer', email: 'customer@example.com', role: 'customer' };
  let service = { _id: new ObjectId(fields.serviceId), title: 'Laptop screen repair', image: 'https://i.ibb.co/test/laptop.jpg', category: 'Laptop & PC', basePrice: 40, technicianName: 'Technician', technicianEmail: 'technician@example.com' };
  let stored, duplicate = false, query;
  const db = { collection: name => name === 'services' ? { findOne: async filter => { query = filter; return service; } } : {
    insertOne: async booking => { if (duplicate) throw Object.assign(new Error('duplicate'), { code: 11000 }); stored = booking; return { insertedId: new ObjectId() }; },
    find: filter => { query = filter; return { sort: () => ({ toArray: async () => [stored] }) }; },
  } };
  const authorization = createAuthorization({ secret: 'booking-test-signing-secret-at-least-32-characters', findUser: async () => user });
  const server = createApp({ db, authorization }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/bookings';
  const token = await authorization.issueToken(user);
  const post = (body, authorized = true) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(fields, false)).status, 401);
    for (const role of ['technician', 'admin']) { user.role = role; assert.equal((await post(fields)).status, 403); }
    user.role = 'customer';
    assert.equal((await post({ ...fields, serviceId: fields.serviceId.toUpperCase(), customerEmail: 'attacker@example.com', basePrice: 1, paymentStatus: 'paid', status: 'completed' })).status, 201);
    assert.equal(query.approvalStatus, 'approved'); assert.equal(query.isAvailable, true);
    assert.equal(stored.customerEmail, user.email); assert.equal(stored.basePrice, 40); assert.equal(stored.finalAmount, 40); assert.equal(stored.status, 'requested'); assert.equal(stored.paymentStatus, 'unpaid'); assert.equal(stored.serviceId, fields.serviceId);
    assert.equal(Object.hasOwn(stored, 'problemImage'), false);
    const withPhoto = await post({ ...fields, problemImage: 'https://i.ibb.co/test/damage.png' });
    assert.equal(withPhoto.status, 201); assert.equal((await withPhoto.json()).problemImage, 'https://i.ibb.co/test/damage.png');
    assert.equal(stored.problemImage, 'https://i.ibb.co/test/damage.png');
    assert.equal((await post({ ...fields, problemImage: 'https://evil.example/image.png' })).status, 400);
    duplicate = true; assert.equal((await post(fields)).status, 409); duplicate = false;
    service.technicianEmail = user.email; assert.equal((await post(fields)).status, 403);
    service = null; assert.equal((await post(fields)).status, 404);
    const list = await fetch(base + '/my?email=other@example.com', { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(list.status, 200); assert.deepEqual(query, { customerEmail: user.email });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
