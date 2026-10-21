import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    rollupOptions: {
      input: 'src/background.js',
      output: {
        format: 'iife',
        entryFileNames: 'background.js',
      },
    },
  },
})
