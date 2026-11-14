// Fonction serverless Vercel : POST /api/moneygram-session  { walletAddress: "G..." }
import { openMoneyGramSession } from './_moneygram.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Use POST.' })
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}
    const out = await openMoneyGramSession(body.walletAddress, process.env.MONEYGRAM_SK, process.env.MONEYGRAM_API_BASE)
    return res.status(out.status).json(out.body)
  } catch {
    return res.status(500).json({ error: 'Could not reach MoneyGram.' })
  }
}
