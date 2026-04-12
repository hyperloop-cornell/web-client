import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: ['gui.cornellhyperloop.com'],
    hmr: process.env.VITE_HMR_HOST ? {
      host: process.env.VITE_HMR_HOST,
      protocol: process.env.VITE_HMR_PROTOCOL || 'wss',
      clientPort: parseInt(process.env.VITE_HMR_PORT || '443'),
    } : undefined,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
