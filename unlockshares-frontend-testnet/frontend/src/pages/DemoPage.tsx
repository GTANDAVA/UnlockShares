import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usd, Gauge, Term, useDemoUi } from '../components/demo'
import { useDemo } from '../lib/useDemo'
import { actions } from '../services/app'
import { chain } from '../chainConfig'
import { derive } from '../services/mockDemo'

const pctRate = (x: number) => `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`

export function DemoPage() {
  const s = useDemo()
  const d = derive(s)
  const { toast } = useDemoUi()
  const demo = s.mode === 'demo'
  // V2 : le prix de démo ne touche que MA position et ne peut pas dépasser le prix de référence.
  const perso = !demo && chain.pretVersion === 2
  const maxPrice = perso ? Math.max(5, Math.floor(s.market.refPrice ?? 260)) : 260
  const [price, setPrice] = useState(s.price || 100)
  const [sending, setSending] = useState(false)

  // Suit le prix lu sur Stellar tant que l'utilisateur ne le modifie pas.
  useEffect(() => setPrice(s.price || 100), [s.price])

  async function go(run: () => Promise<{ text: string; hash?: string }>) {
    setSending(true)
    try {
      toast(await run())
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const apply = (p: number) => (demo ? void actions.setPrice(p) : go(() => actions.setPrice(p)))

  return (
    <>
      <div className="head">
        <div><h1>Demo controls</h1><p className="muted">For the jury: set the Apple price (fake oracle), skip time to see interest, then a liquidator can step in.</p></div>
        {demo && <button className="btn" onClick={() => { actions.reset(); toast('Demo reset') }}><RotateCcw className="i" aria-hidden />Reset</button>}
      </div>
      <div className="pos">
        <div className="line"><span className="muted">{perso ? 'My demo Apple price' : 'Apple share price'}<Term>{perso ? 'fixer_prix_demo()' : 'fixer_prix()'}</Term></span><span style={{ fontSize: 26 }}>{usd(demo ? s.price : price)}</span></div>
        <input
          type="range" min={5} max={maxPrice} step={5} value={demo ? s.price : price}
          onChange={(e) => (demo ? actions.setPrice(Number(e.target.value)) : setPrice(Number(e.target.value)))}
          aria-label="Apple price" style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
        <div className="chips">
          {(demo ? [200, 130, 95, 70] : [150, 100, 70, 40]).filter((p) => p <= maxPrice).map((p) => <button key={p} className="btn" disabled={sending} onClick={() => apply(p)}>{usd(p)}</button>)}
          {!demo && <button className="btn primary" disabled={sending || !s.address || price === s.price} onClick={() => apply(price)}>Apply {usd(price)} on Stellar</button>}
        </div>
        {!demo && <small className="muted">Current price on Stellar: <b>{usd(s.price)}</b>. {perso
          ? <>Changing it is a transaction signed in Varial. It applies <b>only to your loan</b>, never to other users, and cannot go above the reference price ({usd(s.market.refPrice ?? 0)}).</>
          : 'Changing it is a transaction signed in Varial, and it applies to everyone.'}</small>}
        {!demo && d.liquidable && (
          <button className="btn primary" disabled={sending} onClick={() => go(() => actions.liquidate(s.address ?? undefined))} style={{ alignSelf: 'flex-start' }}>
            Liquidator steps in on my loan<Term>liquider()</Term>
          </button>
        )}
        <div className="divider" />
        <div className="line"><span className="muted">Interest<Term>{perso ? 'avancer_temps_perso()' : 'avancer_temps()'}</Term></span><span>Borrow {pctRate(s.market.borrowRate)} · Lend {pctRate(s.market.lendRate)} a year</span></div>
        <small className="muted">Rates follow how much of the pool is borrowed: 0 % when nobody borrows, rising gently to 6 % at 80 % usage, then steeply up to 60 % when the pool is empty. Lenders get the interest, minus 10 % kept as a reserve. {perso ? ' In this version, skipping time only adds interest to your own loan (paid to the reserve): other users and pool rates are not affected.' : ' Skip time to see the debt grow and lenders earn.'}</small>
        <div className="chips">
          <button className="btn" disabled={sending || (!demo && (!s.address || !s.market.demoOpen))} onClick={() => go(() => actions.skipDays(30))}>+1 month</button>
          <button className="btn" disabled={sending || (!demo && (!s.address || !s.market.demoOpen))} onClick={() => go(() => actions.skipDays(365))}>Skip 1 year</button>
        </div>
        {s.shares ? <Gauge ltv={d.ltv} /> : <p className="muted">{demo ? 'Léa has no loan right now.' : 'You have no loan right now.'}</p>}
      </div>

      <p className="small muted">Positions that can be liquidated, yours and other users’, are on the <a href="#liquidations" style={{ textDecoration: 'underline' }}>Liquidations</a> page.</p>
    </>
  )
}
