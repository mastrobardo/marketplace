import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Library mode, not an app build. React is external: the design system must not ship a second copy
 * of it into `apps/web`'s bundle, which is also what keeps hooks working across the boundary.
 *
 * Vite rather than tsup — the choice the rest of the workspace made — because `W12-T02` styles
 * components with CSS Modules and `W12-T03` runs their stories through Vite anyway. One builder in
 * this package, and it is the one Storybook already requires.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // React Aria is external, not bundled. Inlining it produced a 339 KB entry that `apps/web`
      // would pull in whole to use one Button — and ADR-011's ≤170 KB initial-route budget is the
      // thing that would then fail, one task after this one. Left external, the consumer's bundler
      // sees the same ESM everyone else does and takes only the components actually imported.
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^react-aria/],
    },
  },
});
