import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // mkcert-signed cert (see .cert/README below) instead of a plain
    // self-signed one — the CA is only trusted after running
    // `mkcert -install` yourself (a system trust-store change, so this
    // project deliberately doesn't run it for you). Until then, browsers
    // still show a one-time warning to click past, same as any local HTTPS
    // dev server.
    https: {
      cert: readFileSync('./.cert/localhost+2.pem'),
      key: readFileSync('./.cert/localhost+2-key.pem'),
    },
    // Proxy API calls to the backend so the browser only ever talks to one
    // HTTPS origin — this is also what makes the phone treat the page as a
    // secure context, which navigator.geolocation and the Push API both
    // require. Without this, a plain http://<lan-ip> origin silently fails
    // geolocation on iOS Safari with no permission prompt at all.
    proxy: {
      '/auth': 'http://localhost:4001',
      '/logs': 'http://localhost:4001',
      '/dishes': 'http://localhost:4001',
      '/venues': 'http://localhost:4001',
      '/profile': 'http://localhost:4001',
      '/recommendations': 'http://localhost:4001',
      '/moderation': 'http://localhost:4001',
      '/notifications': 'http://localhost:4001',
      '/dev': 'http://localhost:4001',
    },
  },
})
