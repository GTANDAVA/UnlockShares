// Hub & spokes : choix de l'action sur laquelle portent les boutons (garantie, emprunt, démo).
import { Coin } from './demo'
import { kindOf } from './logos'
import { useDemo } from '../lib/useDemo'
import { actions, type StockView } from '../services/app'

/** Pastille ronde avec le logo de l'action (ou son ticker) */
export function StockCoin({ ticker }: { ticker: string }) {
  return <Coin kind={kindOf(ticker) ?? 'other'}>{ticker}</Coin>
}

/** Une puce par action ; rien quand il n'y a qu'une action (pool à une seule action). */
export function StockPicker({ label = 'Share', filter }: { label?: string; filter?: (s: StockView) => boolean }) {
  const s = useDemo()
  const list = filter ? s.stocks.filter(filter) : s.stocks
  if (s.stocks.length < 2) return null
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {list.map((x) => (
        <button
          key={x.jeton} role="radio" aria-checked={x.jeton === s.stock.jeton}
          className={`btn ${x.jeton === s.stock.jeton ? 'primary' : ''}`}
          onClick={() => actions.selectStock(x.jeton)}
          title={x.active ? undefined : 'Paused: no new loans against this share'}
        >
          <StockCoin ticker={x.ticker} />{x.nom}{!x.active && ' (paused)'}
        </button>
      ))}
    </div>
  )
}
