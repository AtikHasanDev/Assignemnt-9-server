import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { validateProfile } from '../src/users/validation.js';
import { createApp } from '../src/app.js';
import { createAuthorization } from '../src/middleware/auth.js';

test('profile validation rejects identity changes, malformed fields, and unsafe images', () => {
  for (const payload of [{ role: 'admin', name: 'Valid Name' }, { email: 'other@example.com' }, { _id: 'other' }, { id: 'other' }]) assert.throws(() => validateProfile(payload), { status: 403 });
  for (const payload of [{}, [], null, { name: ' ' }, { name: 'x'.repeat(101) }, { phone: 'letters' }, { area: {} }, { bio: 'x'.repeat(2001) }, { image: 'https://evil.example/photo.jpg' }, { image: ['https://i.ibb.co/x/photo.jpg'] }, { image: 'http://i.ibb.co/x/photo.jpg' }]) assert.throws(() => validateProfile(payload), { status: 400 });
  assert.deepEqual(validateProfile({ name: '  New Name ', phone: '', bio: ' Bio ', unused: 'ignored' }), { name: 'New Name', phone: '', bio: 'Bio' });
  assert.deepEqual(validateProfile({ image: '' }), { image: '' });
  assert.equal(validateProfile({ image: 'https://i.ibb.co/x/photo.jpg' }).image, 'https://i.ibb.co/x/photo.jpg');
});

test('profile updates work for all roles and target only the authenticated account', async () => {
  const user = { _id: new ObjectId(), name: 'Original', email: 'profile@example.com', role: 'customer' };
  const authorization = createAuthorization({ secret: 'profile-test-signing-secret-at-least-32-characters', findUser: async () => user });
  let saved, missing = false;
  const db = { collection: name => ({ updateOne: async (filter, update) => { saved = { name, filter, update }; return { matchedCount: missing ? 0 : 1 }; } }) };
  const server = createApp({ db, authorization }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/users/profile';
  const token = await authorization.issueToken(user);
  const patch = (body, authenticated = true) => fetch(base, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await patch({ name: 'New Name' }, false)).status, 401);
    for (const role of ['customer', 'technician', 'admin']) {
      user.role = role;
      const response = await patch({ name: 'New Name', phone: '+880 1712345678', area: 'Dhaka', bio: 'Technician bio' });
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      const data = await response.json(); assert.equal(data.user.role, role); assert.equal(data.user.email, user.email); assert.equal(data.user.name, 'New Name');
      assert.equal(saved.name, 'user'); assert.equal(String(saved.filter._id), String(user._id)); assert.equal(saved.update.$set.role, undefined); assert.equal(saved.update.$set.email, undefined);
    }
    assert.equal((await patch({ name: 'New Name', role: 'admin' })).status, 403);
    assert.equal((await patch({ name: 'New Name', email: 'attacker@example.com' })).status, 403);
    missing = true; assert.equal((await patch({ name: 'New Name' })).status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
