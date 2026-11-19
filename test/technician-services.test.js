import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { createApp } from '../src/app.js';
import { createAuthorization } from '../src/middleware/auth.js';
import { validateService } from '../src/services/validation.js';
import { validateImage } from '../src/services/upload.js';

const valid = { title: 'Laptop keyboard repair', description: 'Diagnose and repair your damaged laptop keyboard.', category: 'Laptop & PC', basePrice: 25.5, estimatedDuration: '2 hours', serviceMode: 'Shop Drop-off', serviceArea: 'Mirpur, Dhaka', image: 'https://i.ibb.co/test/keyboard.jpg' };
test('service validation strips privileged fields and rejects unsafe inputs', () => {
  const fields = validateService({ ...valid, approvalStatus: 'approved', technicianEmail: 'other@example.com' });
  assert.equal(fields.approvalStatus, undefined); assert.equal(fields.technicianEmail, undefined);
  for (const patch of [{ basePrice: -1 }, { basePrice: '25' }, { basePrice: 2.555 }, { image: 'http://i.ibb.co/x.jpg' }, { image: 'https://evil.example/x.jpg' }, { category: 'Other' }]) assert.throws(() => validateService({ ...valid, ...patch }), { status: 400 });
});
test('uploads reject arbitrary text and SVG payloads', () => {
  for (const value of ['not an image', Buffer.from('<svg>bad</svg>').toString('base64'), '', null]) assert.throws(() => validateImage(value), { status: 400 });
});
test('technician mutations enforce role, ownership, approval reset, and boolean availability', async () => {
  const id = new ObjectId();
  let user = { _id: id, email: 'owner@example.com', name: 'Owner', role: 'technician' };
  const authorization = createAuthorization({ secret: 'test-only-authorization-key-at-least-32-characters', findUser: async () => user });
  let record;
  const matches = filter => record && String(filter._id) === String(record._id) && filter.technicianEmail === record.technicianEmail;
  const collection = {
    insertOne: async service => { record = { ...service, _id: new ObjectId() }; return { insertedId: record._id }; },
    updateOne: async (filter, update) => { if (!matches(filter)) return { matchedCount: 0 }; Object.assign(record, update.$set); return { matchedCount: 1 }; },
    deleteOne: async filter => { if (!matches(filter)) return { deletedCount: 0 }; record = null; return { deletedCount: 1 }; },
  };
  const app = createApp({ db: { collection: () => collection }, authorization });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/services';
  const token = await authorization.issueToken(user);
  const request = (method, suffix, body, authorized = true) => fetch(base + suffix, { method, headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await request('POST', '', valid, false)).status, 401);
    user.role = 'customer'; assert.equal((await request('POST', '', valid)).status, 403);
    user.role = 'technician'; assert.equal((await request('POST', '', { ...valid, approvalStatus: 'approved' })).status, 201);
    assert.equal(record.approvalStatus, 'pending'); assert.equal(record.technicianEmail, user.email);
    const suffix = '/' + record._id;
    record.approvalStatus = 'approved';
    assert.equal((await request('PATCH', suffix, valid)).status, 200); assert.equal(record.approvalStatus, 'pending');
    assert.equal((await request('PATCH', suffix + '/availability', { isAvailable: 'false' })).status, 400);
    assert.equal((await request('PATCH', suffix + '/availability', { isAvailable: false })).status, 200); assert.equal(record.isAvailable, false);
    record.technicianEmail = 'another@example.com';
    assert.equal((await request('PATCH', suffix, valid)).status, 404);
    assert.equal((await request('DELETE', suffix)).status, 404);
    record.technicianEmail = user.email; assert.equal((await request('DELETE', suffix)).status, 200);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
