import { Coin, eur, Filters, Pill, Ring, Term, usdc, useDemoUi } from '../components/demo'
import { StellarLogo, TokenLogo } from '../components/logos'
import { useDemo } from '../lib/useDemo'
import { DEMO, derive } from '../services/mockDemo'

const ROADMAP: { kind: 'bb' | 'spy' | 'ewy'; code: string; name: string; type: string; max: string; liq: string }[] = [
  { kind: 'bb', code: 'BB', name: 'BlackBerry', type: 'tokenized share', max: '50 %', liq: '80 %' },
  { kind: 'spy', code: 'SPY', name: 'S&P 500 ETF', type: 'tokenized fund', max: '65 %', liq: '85 %' },
  { kind: 'ewy', code: 'EWY', name: 'MSCI South Korea ETF', type: 'tokenized fund', max: '55 %', liq: '80 %' },
]

const pct = (x: number) => `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`

export function BorrowPage() {
  const s = useDemo()
  const d = derive(s)
  const { open, lastBorrow } = useDemoUi()
  const demo = s.mode === 'demo'
  const deposits = demo ? DEMO.poolDeposits : usdc(s.market.totalLent)
  const loans = demo ? DEMO.totalLoans : usdc(s.market.totalBorrowed)
  const used = demo ? DEMO.poolUsed : s.market.used
  const rate = demo ? DEMO.borrowRateLabel : pct(s.market.borrowRate)
  return (
    <>
      <div className="head">
        <div><h1>Borrow</h1><p className="muted">Receive USDC against your tokenized shares, without selling them.</p></div>
        <div className="kpis">
          <div className="kpi"><small>Pool deposits{demo ? ' (demo)' : ''}</small><b>{deposits}</b></div>
          <div className="kpi"><small>Total loans{demo ? ' (demo)' : ''}</small><b>{loans}</b></div>
        </div>
      </div>
      {lastBorrow != null && (
        <div className="co-borrowed" role="status">
          <span><b>{usdc(lastBorrow)} received.</b> <span className="muted">Turn it into euros on your bank account.</span></span>
          <a className="btn primary" href="#retrait">Cash out</a>
        </div>
      )}
      <Filters list={['Markets', 'Assets', 'Guarantee']} />
      <div className="hub">
        <h3><StellarLogo />Stellar Stocks Market</h3>
        <div className="hubmeta">
          <span>Borrow against tokenized shares on Stellar.</span>
          <span>Accepted guarantees <span className="stack"><span className="c-aapl"><TokenLogo kind="aapl" /></span><span className="c-bb"><TokenLogo kind="bb" /></span><span className="c-spy">S</span><span className="c-ewy">K</span></span> · Total borrowed <b>{loans}</b></span>
        </div>
        <div className="tbl"><table>
          <thead><tr><th>Asset</th><th>Your loans</th><th>Yearly cost<Term>borrow APY</Term></th><th>Total borrowed</th><th>Pool used<Term>utilization</Term></th><th /></tr></thead>
          <tbody><tr>
            <td><div className="asset"><Coin kind="usdc">$</Coin><div>USD Coin<small>USDC</small></div></div></td>
            <td>{s.debt ? usdc(s.debt) : '–'}</td>
            <td>{rate}</td>
            <td>{loans}</td>
            <td><Ring p={used} /></td>
            <td><div className="chips"><button className="btn primary" onClick={() => open('borrow')} disabled={!s.shares}>Borrow</button><button className="btn" onClick={() => open('repay')} disabled={!s.debt}>Pay back</button></div></td>
          </tr></tbody>
        </table></div>
        <div className="tbl"><table>
          <thead><tr><th>Accepted guarantee</th><th>Your shares</th><th>You can borrow<Term>max LTV</Term></th><th>Protection sale at<Term>liquidation threshold</Term></th><th>Status</th></tr></thead>
          <tbody>
            <tr>
              <td><div className="asset"><Coin kind="aapl">AAPL</Coin><div>Apple<small>tokenized share</small></div></div></td>
              <td>{s.shares} AAPL as guarantee<small>{eur(d.value)} · {s.walletShares} AAPL in wallet</small></td><td>50 % of value</td><td>80 % of value</td><td><div className="chips"><Pill cls="s-safe">Live</Pill><button className="btn" onClick={() => open('deposit')} disabled={!s.walletShares}>Use as guarantee</button></div></td>
            </tr>
            {ROADMAP.map((r) => (
              <tr key={r.code} className="soon">
                <td><div className="asset"><Coin kind={r.kind}>{r.code}</Coin><div>{r.name}<small>{r.type}</small></div></div></td>
                <td>–</td><td>{r.max} of value</td><td>{r.liq} of value</td><td><span className="tag">Roadmap</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
