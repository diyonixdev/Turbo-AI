import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

const BACKEND_URL = 'http://127.0.0.1:3001'

/**
 * The chat proxy below needs the Express backend (server/index.js). Without it
 * every question fails with a bare 502, so `npm run dev` starts the backend
 * itself unless one is already answering on port 3001 (e.g. `npm run server`
 * in another terminal). Set SKIP_BACKEND=1 to opt out.
 */
function startBackend(): Plugin {
  let child: ChildProcess | null = null
  return {
    name: 'turbo-ai-backend',
    apply: 'serve',
    async configureServer() {
      if (process.env.SKIP_BACKEND) return
      const running = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(1500) })
        .then((res) => res.ok)
        .catch(() => false)
      if (running) {
        console.log('[backend] already running on port 3001, reusing it')
        return
      }
      child = spawn(process.execPath, ['server/index.js'], { stdio: 'inherit' })
      child.on('exit', (code) => {
        if (code) console.log(`[backend] exited with code ${code}`)
        child = null
      })
      const stop = () => child?.kill()
      process.once('exit', stop)
      process.once('SIGINT', () => {
        stop()
        process.exit(0)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), startBackend()],
  server: {
    proxy: {
      '/api': BACKEND_URL,
    },
  },
  preview: {
    proxy: {
      '/api': BACKEND_URL,
    },
  },
})
