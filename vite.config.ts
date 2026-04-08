import { defineConfig } from 'vite';

export default defineConfig({
  base: '/crypto-lab-kdf-arena/',
  resolve: {
    alias: {
      'argon2-browser': 'argon2-browser/dist/argon2-bundled.min.js',
    },
  },
});
