import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    resolve: {
      alias: { ...shared, '@': resolve(__dirname, 'src/renderer/src') }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        // Main window + the floating reminder window.
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          notify: resolve(__dirname, 'src/renderer/notify.html')
        }
      }
    }
  }
})
