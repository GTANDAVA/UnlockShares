import { useEffect, useState } from 'react'

// Prix des actions « Roadmap » (affichage seulement), via /api/prix. Rafraîchis toutes les 5 min.
// Apple n'utilise PAS ce chemin : son prix vient de l'adaptateur on-chain alimenté par les robots.
export function useStockPrices(symbols: string[]): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>({})
  const key = symbols.join(',')
  useEffect(() => {
    let actif = true
    const lire = () =>
      key.split(',').forEach((s) =>
        fetch(`/api/prix?s=${encodeURIComponent(s)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => { if (actif && j && j.price > 0) setPrices((p) => ({ ...p, [s]: j.price })) })
          .catch(() => {}),
      )
    lire()
    const t = setInterval(lire, 5 * 60 * 1000)
    return () => { actif = false; clearInterval(t) }
  }, [key])
  return prices
}
