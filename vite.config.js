import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        content: 'src/content.js',
      },
      output: {
        // content.js must keep a stable name: manifest.json references it,
        // and it must stay free of import statements (content scripts are
        // classic scripts, not modules). Only rename assets/* chunks here
        // if a future shared chunk would split content.js off its imports.
        entryFileNames: (chunk) =>
          chunk.name === 'content' ? 'content.js' : 'assets/[name]-[hash].js',
      },
    },
  },
})
