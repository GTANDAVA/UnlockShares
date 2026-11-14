// Fonction serverless Vercel : POST /api/moneygram-challenge  { address: "G..." }
// Renvoie un défi à faire signer par le wallet (aucune donnée sensible, aucun appel à MoneyGram).
// POST et pas GET : les navigateurs n'envoient pas toujours l'en-tête Origin sur un GET de même origine.
import { handleChallenge } from './_moneygram.js'

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Use POST.' })
  }
  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}
  } catch {
    return res.status(400).json({ error: 'Invalid JSON.' })
  }
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress
  const out = handleChallenge({ origin: req.headers.origin, ip, address: body?.address, env: process.env })
  return res.status(out.status).json(out.body)
}
