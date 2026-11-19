import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceQuery } from '../src/services/query.js';

test('public listings always require approval and availability', () => {
  const query = serviceQuery({ approvalStatus: 'pending', isAvailable: 'false' });
  assert.equal(query.filter.approvalStatus, 'approved');
  assert.equal(query.filter.isAvailable, true);
  assert.equal(query.limit, 12);
});
test('filters, stable price sorting, and pagination compose on the server', () => {
  const query = serviceQuery({ category: 'AC', serviceMode: 'Home Visit', sort: 'price-asc', page: '3', limit: '6' });
  assert.equal(query.filter.category, 'AC'); assert.equal(query.filter.serviceMode, 'Home Visit');
  assert.deepEqual(query.sort, { basePrice: 1, _id: 1 }); assert.equal(query.skip, 12);
});
test('search treats regex metacharacters literally and rejects malformed parameters', () => {
  const query = serviceQuery({ search: 'screen.*(a)' });
  const pattern = query.filter.$or[0].title.$regex;
  assert.equal(new RegExp(pattern, 'i').test('SCREEN.*(a)'), true);
  assert.equal(new RegExp(pattern, 'i').test('screenXYZaaa'), false);
  for (const params of [{ page: '-1' }, { limit: '500' }, { search: { $ne: '' } }, { category: 'unknown' }, { sort: '__proto__' }]) assert.throws(() => serviceQuery(params), { status: 400 });
});
