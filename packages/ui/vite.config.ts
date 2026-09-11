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
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
});
