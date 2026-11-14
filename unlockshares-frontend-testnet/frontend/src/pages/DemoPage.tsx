import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { eur, Gauge, Pill, Term, usdc, useDemoUi } from '../components/demo'
import { useDemo } from '../lib/useDemo'
import { actions } from '../services/app'
import { court, lienCompte } from '../services/chain'
import { derive, zoneOf } from '../services/mockDemo'

const pctRate = (x: number) => `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`

export function DemoPage() {
  const s = useDemo()
  const d = derive(s)
  const { toast } = useDemoUi()
  const demo = s.mode === 'demo'
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
        <div className="line"><span className="muted">Apple share price<Term>fixer_prix()</Term></span><span style={{ fontSize: 26 }}>{eur(demo ? s.price : price)}</span></div>
        <input
          type="range" min={10} max={260} step={5} value={demo ? s.price : price}
          onChange={(e) => (demo ? actions.setPrice(Number(e.target.value)) : setPrice(Number(e.target.value)))}
          aria-label="Apple price" style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
        <div className="chips">
          {(demo ? [200, 130, 95, 70] : [150, 100, 70, 40]).map((p) => <button key={p} className="btn" disabled={sending} onClick={() => apply(p)}>{eur(p)}</button>)}
          {!demo && <button className="btn primary" disabled={sending || !s.address || price === s.price} onClick={() => apply(price)}>Apply {eur(price)} on Stellar</button>}
        </div>
        {!demo && <small className="muted">Current price on Stellar: <b>{eur(s.price)}</b>. Changing it is a transaction signed in Varial, and it applies to everyone.</small>}
        {!demo && d.liquidable && (
          <button className="btn primary" disabled={sending} onClick={() => go(() => actions.liquidate(s.address ?? undefined))} style={{ alignSelf: 'flex-start' }}>
            Liquidator steps in on my loan<Term>liquider()</Term>
          </button>
        )}
        <div className="divider" />
        <div className="line"><span className="muted">Interest<Term>avancer_temps()</Term></span><span>Borrow {pctRate(s.market.borrowRate)} · Lend {pctRate(s.market.lendRate)} a year</span></div>
        <small className="muted">Rates follow how much of the pool is borrowed: 0 % when nobody borrows, rising gently to 6 % at 80 % usage, then steeply up to 60 % when the pool is empty. Lenders get the interest, minus 10 % kept as a reserve. Skip time to see the debt grow and lenders earn.</small>
        <div className="chips">
          <button className="btn" disabled={sending || (!demo && (!s.address || !s.market.demoOpen))} onClick={() => go(() => actions.skipDays(30))}>+1 month</button>
          <button className="btn" disabled={sending || (!demo && (!s.address || !s.market.demoOpen))} onClick={() => go(() => actions.skipDays(365))}>Skip 1 year</button>
        </div>
        {s.shares ? <Gauge ltv={d.ltv} /> : <p className="muted">{demo ? 'Léa has no loan right now.' : 'You have no loan right now.'}</p>}
      </div>

      <div className="divider" />
      <h2>Borrower positions</h2>
      <p className="small muted">When a loan goes above 80 % of the shares’ value, anyone can act as liquidator: they pay back just enough debt to bring the loan back to 60 %, and receive shares worth that amount + 5 %. Above about 95 %, they pay back the whole debt.</p>
      {s.borrowers.length ? (
        <div className="tbl"><table>
          <thead><tr><th>Borrower</th><th>Guarantee</th><th>Loan</th><th>Share of value<Term>LTV</Term></th><th /></tr></thead>
          <tbody>
            {s.borrowers.map((b) => {
              const z = zoneOf(b.ltv)
              const me = b.address === s.address
              return (
                <tr key={b.address}>
                  <td>{demo ? b.address : <a href={lienCompte(b.address)} target="_blank" rel="noreferrer">{court(b.address)}{me ? ' (you)' : ''}</a>}</td>
                  <td>{b.shares.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} AAPL<small>{eur(b.shares * s.price)}</small></td>
                  <td>{usdc(b.debt)}</td>
                  <td><Pill cls={z.cls}>{Math.round(b.ltv * 100)} % · {z.label}</Pill></td>
                  <td>
                    <button
                      className="btn primary" disabled={!b.liquidable || sending || (!demo && !s.address)}
                      onClick={() => go(async () => { const r = await actions.liquidate(demo ? undefined : b.address); if (demo) window.location.hash = 'accueil'; return r })}
                    >
                      Liquidator steps in<Term>liquider()</Term>
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      ) : (
        <div className="empty"><b>No open loan</b><span className="muted">Use shares as a guarantee and borrow to see your position here.</span></div>
      )}
      {!demo && <p className="small muted">To liquidate you need testnet USDC (free on faucet.circle.com) and an account allowed to hold tAAPL.</p>}
    </>
  )
}
