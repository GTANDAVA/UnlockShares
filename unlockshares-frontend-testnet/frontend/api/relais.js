// Fonction serverless Vercel : POST /api/relais  { func, auth }  (format du RelayerClient de smart-account-kit)
// Fait payer les frais réseau des comptes passkey par OpenZeppelin Channels. Voir _relais.js pour ce qui est accepté.
import { traiter } from './_relais.js'

// Le relais attend la confirmation de la transaction (quelques secondes) : on laisse jusqu'à 60 s.
export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Use POST.' })
  }
  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid JSON.' })
  }
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress
  const out = await traiter({ origin: req.headers.origin, ip, body, env: process.env })
  return res.status(out.status).json(out.body)
}
