import { defineWorkspaceConfig } from '@marketplace/config/vitest';

export default defineWorkspaceConfig({ test: { include: ['tests/**/*.test.ts'] } });
