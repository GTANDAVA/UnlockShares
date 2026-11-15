import { Clock } from 'lucide-react'

/** Petit encart discret (style Uniswap) : les actions suivent les horaires de la Bourse américaine. */
export function MarketHoursNote() {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--muted)', fontSize: 14, lineHeight: 1.45 }}>
      <Clock size={18} style={{ flex: 'none', marginTop: 1 }} aria-hidden />
      <span>Shares follow US stock market hours. Outside them, prices update less often.</span>
    </div>
  )
}
