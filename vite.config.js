import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  // The content script is built separately by vite.content.config.js as a
  // self-contained IIFE: it is a classic script (no import statements), so
  // it must never share chunks with this build.
})
