import { defineConfig } from 'vite';
import { packsPlugin } from '@face-maker/assets/vite-plugin';

// The library packs (packs/<id>/) are served at /packs/** in dev; a build only copies the packs marked shareable.
export default defineConfig({
  base: './',
  plugins: [packsPlugin()],
  server: { fs: { allow: ['../..'] } },
  build: { target: 'es2022' },
});
