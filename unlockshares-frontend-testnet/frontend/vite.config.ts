import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
// @ts-expect-error module JS partagé avec la fonction Vercel (pas de types)
import { openMoneyGramSession } from './api/_moneygram.js'

// En local (npm run dev), imite la fonction Vercel /api/moneygram-session.
// La clé secrète est lue dans .env.local (MONEYGRAM_SK, sans préfixe VITE_ : jamais envoyée au navigateur).
function moneygramDev(env: Record<string, string>): Plugin {
  return {
    name: 'moneygram-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/moneygram-session', (req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', async () => {
          let out = { status: 405, body: { error: 'Use POST.' } as Record<string, unknown> }
          try {
            if (req.method === 'POST') {
              const { walletAddress } = JSON.parse(raw || '{}')
              out = await openMoneyGramSession(walletAddress, env.MONEYGRAM_SK, env.MONEYGRAM_API_BASE)
            }
          } catch {
            out = { status: 500, body: { error: 'Could not reach MoneyGram.' } }
          }
          res.statusCode = out.status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(out.body))
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), moneygramDev(loadEnv(mode, process.cwd(), ''))],
}))
