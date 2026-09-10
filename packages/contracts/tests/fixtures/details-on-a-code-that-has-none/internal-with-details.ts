import { errorEnvelope } from '../../../src/index.js';

// INTERNAL_ERROR has no entry in ErrorDetails, so it must accept no payload at all. Nothing about
// an internal failure is safe on the wire, and a `details` object is the easiest way to leak it.
export const leaky = errorEnvelope('INTERNAL_ERROR', 'An unexpected error occurred.', 'req-1', {
  stack: 'at Object.<anonymous> (/app/src/db.ts:42:11)',
});
