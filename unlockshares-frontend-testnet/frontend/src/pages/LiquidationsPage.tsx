import { useState } from 'react'
import { Pill, Term, usd, usdc, useDemoUi } from '../components/demo'
import { useDemo } from '../lib/useDemo'
import { actions } from '../services/app'
import { court, jetonPret, lienCompte } from '../services/chain'
import { zoneOf } from '../services/mockDemo'

/** Vraie liquidation on-chain : n'importe quel compte peut rembourser un prêt devenu trop risqué et recevoir la garantie. */
export function LiquidationsPage() {
  const s = useDemo()
  const { toast } = useDemoUi()
  const demo = s.mode === 'demo'
  const [sending, setSending] = useState(false)
  const list = [...s.borrowers].sort((a, b) => Number(b.liquidable) - Number(a.liquidable) || b.ltv - a.ltv)
  const ready = list.filter((b) => b.liquidable).length

  const hub = s.stocks.length > 1
  async function liquidate(address: string, jeton?: string) {
    setSending(true)
    try {
      const r = await actions.liquidate(demo ? undefined : address, jeton)
      toast(r)
      if (demo) window.location.hash = 'accueil'
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Liquidations</h1>
          <p className="muted">
            {demo ? 'Simulation: Léa’s loan.' : 'Real transactions on Stellar testnet.'} When a loan goes above {hub ? 'the protection-sale threshold of its share' : '80 % of the shares’ value'}, anyone can step in as liquidator:
            they pay back debt in {jetonPret()} and receive the shares as a guarantee, worth that amount + 5 %.{hub && ' Each share is a separate loan: only the loan against the share that fell can be sold.'}
          </p>
        </div>
      </div>

      <div className="pos">
        <div className="line"><span className="muted">Positions that can be liquidated now</span><span style={{ fontSize: 26 }}>{ready}</span></div>
        <small className="muted">
          Below about 95 %, the liquidator pays just enough to bring the loan back to 60 %. Above, they pay the whole debt and receive at most all the guarantee.
          The pool cash is never used: the liquidator brings their own {jetonPret()}, and any extra sent to cover interest is returned at once.
        </small>
      </div>

      <div className="divider" />
      <h2>Borrower positions</h2>
      {list.length ? (
        <div className="tbl"><table>
          <thead><tr><th>Borrower</th><th>Guarantee</th><th>Loan</th><th>Share of value<Term>LTV</Term></th><th /></tr></thead>
          <tbody>
            {list.map((b) => {
              const st = s.stocks.find((x) => x.jeton === b.jeton)
              const z = zoneOf(b.ltv, st)
              const me = b.address === s.address
              return (
                <tr key={`${b.address}|${b.jeton ?? ''}`}>
                  <td>{demo ? b.address : <a href={lienCompte(b.address)} target="_blank" rel="noreferrer">{court(b.address)}{me ? ' (you)' : ''}</a>}</td>
                  <td>{b.shares.toLocaleString('en-US', { maximumFractionDigits: 2 })} {b.ticker ?? 'AAPL'}<small>{usd(b.shares * (b.price ?? s.price))}</small></td>
                  <td>{usdc(b.debt)}</td>
                  <td><Pill cls={z.cls}>{Math.round(b.ltv * 100)} % · {z.label}</Pill></td>
                  <td>
                    <button className="btn primary" disabled={!b.liquidable || sending || (!demo && !s.address)} onClick={() => void liquidate(b.address, b.jeton)}>
                      Liquidator steps in<Term>liquider()</Term>
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      ) : (
        <div className="empty"><b>No open loan</b><span className="muted">Use shares as a guarantee and borrow to see positions here.</span></div>
      )}
      {!demo && !s.address && <p className="small muted">Connect Varial to liquidate.</p>}
      {!demo && <p className="small muted">To liquidate you need {jetonPret()} on testnet and an account allowed to hold {hub ? 'the test shares' : 'tAAPL'} (“Get test tokens”).</p>}
    </>
  )
}
