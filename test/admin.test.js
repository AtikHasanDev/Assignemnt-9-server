import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { createApp } from '../src/app.js';
import { createAuthorization } from '../src/middleware/auth.js';

test('admin moderation enforces role, rejects self-role changes, and limits update fields', async () => {
  const adminId = new ObjectId(), targetId = new ObjectId(), serviceId = new ObjectId();
  const user = { _id: adminId, role: 'admin', email: 'admin-test@example.com' };
  const authorization = createAuthorization({ secret: 'test-admin-key-at-least-thirty-two-characters', findUser: async () => user });
  let saved;
  const db = { collection: name => ({ updateOne: async (filter, update) => {
    saved = { name, filter, update };
    return { matchedCount: String(filter._id) === String(targetId) || String(filter._id) === String(serviceId) ? 1 : 0 };
  } }) };
  const server = createApp({ db, authorization }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/admin';
  const token = await authorization.issueToken(user);
  const request = (path, body, authenticated = true) => fetch(base + path, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await request('/users/' + targetId + '/role', { role: 'technician' }, false)).status, 401);
    user.role = 'customer'; assert.equal((await request('/users/' + targetId + '/role', { role: 'admin' })).status, 403);
    user.role = 'admin';
    assert.equal((await request('/users/' + adminId + '/role', { role: 'customer' })).status, 403);
    assert.equal((await request('/users/' + targetId + '/role', { role: 'owner' })).status, 400);
    assert.equal((await request('/users/' + targetId + '/role', { role: 'technician', email: 'attacker@example.com' })).status, 200);
    assert.equal(saved.name, 'user'); assert.equal(saved.update.$set.role, 'technician'); assert.equal(saved.update.$set.email, undefined);
    assert.equal((await request('/services/' + serviceId + '/approval', { approvalStatus: 'pending' })).status, 400);
    assert.equal((await request('/services/' + serviceId + '/approval', { approvalStatus: 'approved', basePrice: 1 })).status, 200);
    assert.equal(saved.name, 'services'); assert.equal(saved.update.$set.approvalStatus, 'approved'); assert.equal(saved.update.$set.basePrice, undefined); assert.equal(saved.update.$set.moderatedBy, user.email);
    assert.equal((await request('/services/' + new ObjectId() + '/approval', { approvalStatus: 'rejected' })).status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
