import { defineConfig } from 'astro/config';
export default defineConfig({
  site: process.env.SITE_URL || 'https://uba.pages.dev',
  trailingSlash: 'ignore',
  build: { format: 'directory', concurrency: 4 },
  vite: { build: { chunkSizeWarningLimit: 2000 } },
});
