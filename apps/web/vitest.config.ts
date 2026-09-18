import react from '@vitejs/plugin-react';
import { defineWorkspaceConfig } from '@marketplace/config/vitest';

export default defineWorkspaceConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    /**
     * Vitest's own 5 s default is the *other* timeout this suite runs into: `auth.test.tsx` AC5
     * failed at 5116 ms on the same CI runs (`tests/setup.ts` has the measurements). A page test
     * that drives a form through a router action legitimately takes seconds on a 2-core runner, and
     * a test that is genuinely stuck still fails — later, and for its own reason.
     */
    testTimeout: 20_000,
  },
});
