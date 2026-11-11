import { existsSync, readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const cert = './.cert/localhost+2.pem'
const key = './.cert/localhost+2-key.pem'
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // localhost is a secure browser context without a certificate. Optional
    // mkcert files enable HTTPS for testing from a phone on the LAN.
    ...(existsSync(cert) && existsSync(key) ? { https: { cert: readFileSync(cert), key: readFileSync(key) } } : {}),
    proxy: Object.fromEntries(['/auth', '/bookmarks', '/restaurants', '/health'].map((path) => [path, 'http://localhost:4001'])),
  },
})
