// Lecture du dernier cours d'une action sur Yahoo Finance (gratuit, sans clé).
// Affichage seulement : ce prix ne sert à aucun calcul de prêt.
export const SYMBOLES = { BB: 'BB' } // liste fermée : on ne relaie pas n'importe quel ticker

export async function lirePrix(symbole, fetchFn = fetch) {
  const ticker = SYMBOLES[symbole]
  if (!ticker) return { status: 400, body: { error: 'Unknown symbol.' } }
  let r
  try {
    r = await fetchFn(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`, {
      headers: { 'user-agent': 'Mozilla/5.0 (UnlockShares price display)', accept: 'application/json' },
    })
  } catch {
    return { status: 502, body: { error: 'Price source unreachable.' } }
  }
  if (!r.ok) return { status: 502, body: { error: 'Price source unavailable.' } }
  const meta = (await r.json().catch(() => null))?.chart?.result?.[0]?.meta
  const prix = meta?.regularMarketPrice
  if (!(prix > 0) || (meta.symbol && meta.symbol !== ticker) || (meta.currency && meta.currency !== 'USD')) {
    return { status: 502, body: { error: 'Price not available.' } }
  }
  return { status: 200, body: { symbol: symbole, price: prix, time: meta.regularMarketTime ?? null } }
}
