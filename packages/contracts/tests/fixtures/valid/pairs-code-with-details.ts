import { AppError, errorEnvelope } from '../../../src/index.js';

export const validation = errorEnvelope('VALIDATION_FAILED', 'bad body', 'req-1', {
  issues: [{ path: 'email', message: 'must be an email' }],
});

export const limited = errorEnvelope('RATE_LIMITED', 'slow down', 'req-2', {
  retryAfterSeconds: 30,
});

// A code that declares no details takes none — and that is the whole call, not an empty object.
export const notFound = errorEnvelope('NOT_FOUND', 'no such thing', 'req-3');

export const thrown = new AppError('VALIDATION_FAILED', 'bad body', {
  issues: [{ path: 'name', message: 'required' }],
});
