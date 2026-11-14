import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
// @ts-expect-error module JS partagé avec les fonctions Vercel (pas de types)
import { handleChallenge, handleSession } from './api/_moneygram.js'

// En local (npm run dev), imite les fonctions Vercel /api/moneygram-challenge et /api/moneygram-session.
// Les secrets sont lus dans .env.local (MONEYGRAM_SK, sans préfixe VITE_ : jamais envoyés au navigateur).
// Sans RAMPS_CHALLENGE_SECRET local, un secret aléatoire est généré pour la durée du serveur de dev.
function moneygramDev(fileEnv: Record<string, string>): Plugin {
  const env = { ...fileEnv, RAMPS_CHALLENGE_SECRET: fileEnv.RAMPS_CHALLENGE_SECRET || randomBytes(32).toString('hex') }
  const json = (req: IncomingMessage, res: ServerResponse, run: (body: Record<string, unknown>) => Promise<{ status: number; body: unknown }> | { status: number; body: unknown }) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      let out: { status: number; body: unknown } = { status: 405, body: { error: 'Use POST.' } }
      try {
        if (req.method === 'POST') out = await run(JSON.parse(raw || '{}'))
      } catch {
        out = { status: 400, body: { error: 'Invalid request.' } }
      }
      res.statusCode = out.status
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(out.body))
    })
  }
  return {
    name: 'moneygram-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/moneygram-challenge', (req, res) =>
        json(req, res, (b) => handleChallenge({ origin: req.headers.origin, ip: req.socket.remoteAddress, address: b.address, env, dev: true })))
      server.middlewares.use('/api/moneygram-session', (req, res) =>
        json(req, res, (b) => handleSession({ origin: req.headers.origin, ip: req.socket.remoteAddress, body: b, env, dev: true })))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), moneygramDev(loadEnv(mode, process.cwd(), ''))],
}))
