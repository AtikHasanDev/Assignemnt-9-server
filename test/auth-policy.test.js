import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationRole, validatePassword } from '../src/auth/policy.js';

test('registration never accepts an administrator role', () => {
  for (const role of ['admin', 'ADMIN', '', null, undefined, {}, ['technician']]) assert.equal(registrationRole(role), 'customer');
  assert.equal(registrationRole('technician'), 'technician');
});
test('server rejects weak passwords even when client validation is bypassed', () => {
  for (const password of ['abc', 'abcdefg', 'ABCDEFG', null, 123456]) assert.throws(() => validatePassword(password));
  assert.doesNotThrow(() => validatePassword('Repair123'));
});

