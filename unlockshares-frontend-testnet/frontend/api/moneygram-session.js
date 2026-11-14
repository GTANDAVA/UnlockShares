// Fonction serverless Vercel : POST /api/moneygram-session  { walletAddress, token, signature }
// La session n'est émise qu'après vérification du défi signé par le wallet (voir _moneygram.js).
import { handleSession } from './_moneygram.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Use POST.' })
  }
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) return res.status(415).json({ error: 'JSON expected.' })
  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}
  } catch {
    return res.status(400).json({ error: 'Invalid JSON.' })
  }
  if (JSON.stringify(body).length > 2000) return res.status(413).json({ error: 'Request too large.' })
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress
  const out = await handleSession({ origin: req.headers.origin, ip, body, env: process.env })
  return res.status(out.status).json(out.body)
}
