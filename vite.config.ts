import { defineConfig } from 'vite';

// One JavaScript bundle (dynamic imports inlined) so scripts/build-single.mjs can produce a
// self-contained HTML file.
export default defineConfig({
  base: './',
  build: {
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
