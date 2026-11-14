// Logique partagée (Vercel + serveur de dev Vite) : ouvre une session MoneyGram Ramps.
// La clé SECRÈTE reste ici, côté serveur. Analogie : le guichetier garde la clé du coffre, le client ne reçoit qu'un ticket (sessionToken).
// Le préfixe "_" empêche Vercel d'en faire une route publique.

const SANDBOX = 'https://playground.xramps.moneygram.com/api'

/** @returns {Promise<{ status: number, body: Record<string, unknown> }>} */
export async function openMoneyGramSession(walletAddress, secretKey, base = SANDBOX) {
  if (!secretKey) return { status: 500, body: { error: 'MONEYGRAM_SK is not set on the server.' } }
  if (typeof walletAddress !== 'string' || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    return { status: 400, body: { error: 'Invalid Stellar address (G...).' } }
  }
  const r = await fetch(`${base.replace(/\/+$/, '')}/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': secretKey },
    body: JSON.stringify({ walletAddress, chain: 'stellar' }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.sessionToken || !j.widgetUrl) {
    return { status: r.ok ? 502 : r.status, body: { error: j.message ?? j.error ?? `MoneyGram refused the session (${r.status}).` } }
  }
  // On ne renvoie que le strict nécessaire au navigateur.
  return { status: 200, body: { sessionToken: j.sessionToken, sessionId: j.sessionId, widgetUrl: j.widgetUrl } }
}
