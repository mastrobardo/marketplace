import react from '@vitejs/plugin-react';
import { defineWorkspaceConfig } from '@marketplace/config/vitest';

export default defineWorkspaceConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'] },
});
