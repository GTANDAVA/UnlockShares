// Fonction serverless Vercel : GET /api/prix?s=BB -> { symbol, price, time }
// Prix affiché seulement (ligne BlackBerry « Roadmap »). Mis en cache 5 min chez Vercel.
import { lirePrix } from './_prix.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Use GET.' })
  }
  const out = await lirePrix(String(req.query?.s ?? ''))
  res.setHeader('Cache-Control', out.status === 200 ? 's-maxage=300, stale-while-revalidate=600' : 'no-store')
  return res.status(out.status).json(out.body)
}
