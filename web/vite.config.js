import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: ['es2020', 'chrome80', 'firefox78', 'safari13', 'edge80'],
    cssTarget: ['chrome80', 'firefox78', 'safari13', 'edge80']
  }
});
