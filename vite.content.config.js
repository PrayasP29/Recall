import { defineConfig } from 'vite'

// Builds src/content.js as a self-contained classic script (IIFE) into
// dist/content.js. Runs after the main popup build, which owns dist/
// (manifest.json, icons, popup). A separate pass is required because
// content scripts cannot use ES module imports, and the shared
// src/lib modules would otherwise be code-split into an importable chunk.
export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    rollupOptions: {
      input: 'src/content.js',
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
      },
    },
  },
})
