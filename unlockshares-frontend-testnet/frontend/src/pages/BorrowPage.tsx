import { Coin, usd, Filters, Pill, Ring, Term, usdc, useDemoUi } from '../components/demo'
import { StellarLogo, TokenLogo } from '../components/logos'
import { MarketHoursNote } from '../components/MarketHoursNote'
import { useDemo } from '../lib/useDemo'
import { useStockPrices } from '../lib/useStockPrice'
import { jetonPret, nomJetonPret } from '../services/chain'
import { DEMO, derive } from '../services/mockDemo'
import { actions, type Kind } from '../services/app'
import { StockCoin } from '../components/StockPicker'

const ROADMAP: { kind: 'bb' | 'spy' | 'ewy'; code: string; name: string; type: string; max: string; liq: string }[] = [
  { kind: 'bb', code: 'BB', name: 'BlackBerry', type: 'tokenized share', max: '50 %', liq: '80 %' },
  { kind: 'spy', code: 'SPY', name: 'SPY', type: 'tokenized fund', max: '65 %', liq: '85 %' },
  { kind: 'ewy', code: 'EWY', name: 'EWY', type: 'tokenized fund', max: '55 %', liq: '80 %' },
]

const pct = (x: number) => `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`

export function BorrowPage() {
  const s = useDemo()
  const d = derive(s)
  // Prix de marché de l'action (pas le prix de démo perso).
  const aaplPrice = s.mode === 'demo' ? s.price : (s.market.refPrice ?? s.price)
  // Lignes Roadmap : prix d'affichage (Yahoo). Apple : prix on-chain des robots (aaplPrice ci-dessus).
  const hub = s.stocks.length > 1
  // Hub : les actions déjà acceptées ne sont plus « Roadmap ».
  const roadmap = ROADMAP.filter((r) => !s.stocks.some((x) => x.ticker === r.code))
  const roadmapPrices = useStockPrices(roadmap.map((r) => r.code))
  const { open, lastBorrow } = useDemoUi()
  /** Choisit l'action puis ouvre la fenêtre (garantie, emprunt, remboursement) */
  const pick = (jeton: string, k: Kind) => {
    actions.selectStock(jeton)
    open(k)
  }
  const totalDebt = hub ? s.stocks.reduce((n, x) => n + x.debt, 0) : s.debt
  const demo = s.mode === 'demo'
  const deposits = demo ? DEMO.poolDeposits : usdc(s.market.totalLent)
  const loans = demo ? DEMO.totalLoans : usdc(s.market.totalBorrowed)
  const used = demo ? DEMO.poolUsed : s.market.used
  const rate = demo ? DEMO.borrowRateLabel : hub ? `from ${pct(Math.min(...s.stocks.map((x) => x.rate)))}` : pct(s.market.borrowRate)
  return (
    <>
      <div className="head">
        <div><h1>Borrow</h1><p className="muted">Receive {jetonPret()} against your tokenized shares, without selling them.{hub && ' Each share is a separate loan: if one share falls, only the loan against it can be sold.'}</p></div>
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
      <MarketHoursNote />
      <Filters list={['Markets', 'Assets', 'Guarantee']} />
      <div className="hub">
        <h3><StellarLogo />Stellar Stocks Market</h3>
        <div className="hubmeta">
          <span>Borrow against tokenized shares on Stellar.</span>
          <span>Accepted guarantees {hub ? <span className="stack">{s.stocks.map((x) => <StockCoin key={x.jeton} ticker={x.ticker} />)}</span> : <span className="stack"><span className="c-aapl"><TokenLogo kind="aapl" /></span><span className="c-bb"><TokenLogo kind="bb" /></span><span className="c-spy">S</span><span className="c-ewy">K</span></span>} · Total borrowed <b>{loans}</b></span>
        </div>
        <div className="tbl"><table>
          <thead><tr><th>Asset</th><th>Your loans</th><th>Yearly cost<Term>borrow APY</Term></th><th>Total borrowed</th><th>Pool used<Term>utilization</Term></th><th /></tr></thead>
          <tbody><tr>
            <td><div className="asset"><Coin kind="usdc">$</Coin><div>{nomJetonPret()}<small>{jetonPret()}</small></div></div></td>
            <td>{totalDebt ? usdc(totalDebt) : '–'}</td>
            <td>{rate}</td>
            <td>{loans}</td>
            <td><Ring p={used} /></td>
            <td>{hub ? <small className="muted">Pick a share below</small> : <div className="chips"><button className="btn primary" onClick={() => open('borrow')} disabled={!s.shares}>Borrow</button><button className="btn" onClick={() => open('repay')} disabled={!s.debt}>Pay back</button></div>}</td>
          </tr></tbody>
        </table></div>
        <div className="tbl"><table>
          <thead>{hub
            ? <tr><th>Accepted guarantee</th><th>Price</th><th>Your shares</th><th>Borrow up to<Term>max LTV · liquidation threshold</Term></th><th>Yearly cost<Term>base + risk premium</Term></th><th /></tr>
            : <tr><th>Accepted guarantee</th><th>Price</th><th>Your shares</th><th>You can borrow<Term>max LTV</Term></th><th>Protection sale at<Term>liquidation threshold</Term></th><th>Status</th></tr>}</thead>
          <tbody>
            {hub && s.stocks.map((x) => (
              <tr key={x.jeton} className={x.active ? undefined : 'soon'}>
                <td><div className="asset"><StockCoin ticker={x.ticker} /><div>{x.nom}<small>{x.active ? (x.fonds ? 'tokenized fund' : 'tokenized share') : 'paused'}</small></div></div></td>
                <td>{x.refPrice ? usd(x.refPrice) : '–'}{x.priceDate && <small>{x.oracle ? 'robots' : 'admin'} · {x.priceDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small>}</td>
                <td>{x.shares} {x.ticker} locked<small>{x.walletShares} in wallet{x.debt ? ` · ${usdc(x.debt)} borrowed` : ''}</small></td>
                <td>{pct(x.ltvMax)} of value<small>sale at {pct(x.seuil)} · {usd(x.capLeft)} left</small></td>
                <td>{pct(x.rate)}{x.prime > 0 && <small>incl. +{pct(x.prime)} premium</small>}</td>
                <td><div className="chips" style={{ flexWrap: 'nowrap' }}>
                  {x.shares > 0
                    ? <button className="btn primary" onClick={() => pick(x.jeton, 'borrow')} disabled={!x.active}>Borrow</button>
                    : <button className="btn" onClick={() => pick(x.jeton, 'deposit')} disabled={!x.walletShares || !x.active}>Use as guarantee</button>}
                  {x.debt > 0 && <button className="btn" onClick={() => pick(x.jeton, 'repay')}>Pay back</button>}
                </div></td>
              </tr>
            ))}
            {!hub && <tr>
              <td><div className="asset"><Coin kind="aapl">AAPL</Coin><div>Apple<small>tokenized share</small></div></div></td>
              <td>{aaplPrice ? usd(aaplPrice) : '–'}</td>
              <td>{s.shares} AAPL as guarantee<small>{usd(d.value)} · {s.walletShares} AAPL in wallet</small></td><td>50 % of value</td><td>80 % of value</td><td><div className="chips"><Pill cls="s-safe">Live</Pill><button className="btn" onClick={() => open('deposit')} disabled={!s.walletShares}>Use as guarantee</button></div></td>
            </tr>}
            {roadmap.map((r) => (
              <tr key={r.code} className="soon">
                <td><div className="asset"><Coin kind={r.kind}>{r.code}</Coin><div>{r.name}<small>{r.type}</small></div></div></td>
                <td>{roadmapPrices[r.code] ? `$${roadmapPrices[r.code].toFixed(2)}` : '–'}</td><td>–</td>{hub ? <><td>{r.max} of value<small>sale at {r.liq}</small></td><td>–</td></> : <><td>{r.max} of value</td><td>{r.liq} of value</td></>}<td><span className="tag">Roadmap</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
