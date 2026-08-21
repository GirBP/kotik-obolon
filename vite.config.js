import { defineConfig } from 'vite';

// Проєктний сайт GitHub Pages (girbp.github.io/kotik-obolon).
// base:'./' → усі шляхи відносні, тож збірка працює під будь-яким префіксом
// без хардкоду '/kotik-obolon/'. Статика (data/, icons/, manifest) — у public/.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: true,
  },
  server: { port: 5173, open: false },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
