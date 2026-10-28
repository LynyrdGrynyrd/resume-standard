import { defineConfig } from 'vite';

export default defineConfig({
  // PDF generation and rendering are deliberately local; their libraries are large.
  build: { chunkSizeWarningLimit: 1500 },
});
