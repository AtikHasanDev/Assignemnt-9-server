import { APIError } from 'better-auth/api';

export function registrationRole(value) { return value === 'technician' ? 'technician' : 'customer'; }
export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 6 || !/[A-Z]/.test(value) || !/[a-z]/.test(value)) {
    throw new APIError('BAD_REQUEST', { message: 'Password needs at least 6 characters, one uppercase letter, and one lowercase letter.' });
  }
}

