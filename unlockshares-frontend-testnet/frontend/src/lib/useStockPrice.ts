import { useEffect, useState } from 'react'

// Prix d'une action « Roadmap » (affichage seulement), via /api/prix. Rafraîchi toutes les 5 min.
export function useStockPrice(symbol: string): number | null {
  const [price, setPrice] = useState<number | null>(null)
  useEffect(() => {
    let actif = true
    const lire = () =>
      fetch(`/api/prix?s=${encodeURIComponent(symbol)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (actif && j && j.price > 0) setPrice(j.price) })
        .catch(() => {})
    lire()
    const t = setInterval(lire, 5 * 60 * 1000)
    return () => { actif = false; clearInterval(t) }
  }, [symbol])
  return price
}
