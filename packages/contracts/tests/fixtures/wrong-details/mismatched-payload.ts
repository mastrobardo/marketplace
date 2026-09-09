import { errorEnvelope } from '../../../src/index.js';

// `retryAfterSeconds` belongs to RATE_LIMITED. Pairing it with VALIDATION_FAILED is the mistake
// that made `details` worth typing at all — before this it was Record<string, unknown>.
export const wrong = errorEnvelope('VALIDATION_FAILED', 'bad body', 'req-1', {
  retryAfterSeconds: 30,
});
